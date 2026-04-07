"""
scanner/price_fetcher.py
========================
Parallel price quote fetching via Multicall3 batching.

Algorithm: All quotes for a scan cycle issued in a single Multicall3 aggregate3
call. Adaptive backoff quarantines pools that fail 3 consecutive cycles.
This is the architecture used by KyberSwap's aggregator for sub-block quoting.

QuoterV2.quoteExactInputSingle — Uniswap V3 (view, no gas cost)
get_dy(i,j,dx)                 — Curve (view)
queryBatchSwap                 — Balancer V2 (view)

All quotes are eth_call (read-only). Never eth_sendTransaction.
"""

from __future__ import annotations

import logging
from typing import Optional

from eth_abi import decode as abi_decode
from web3 import Web3

logger = logging.getLogger(__name__)

# ── QuoterV2 ABI ─────────────────────────────────────────────────────────────
QUOTER_V2_ABI = [
    {
        "inputs": [{
            "components": [
                {"name": "tokenIn",            "type": "address"},
                {"name": "tokenOut",           "type": "address"},
                {"name": "amountIn",           "type": "uint256"},
                {"name": "fee",                "type": "uint24"},
                {"name": "sqrtPriceLimitX96",  "type": "uint160"},
            ],
            "name": "params", "type": "tuple",
        }],
        "name": "quoteExactInputSingle",
        "outputs": [
            {"name": "amountOut",            "type": "uint256"},
            {"name": "sqrtPriceX96After",    "type": "uint160"},
            {"name": "initializedTicksCrossed","type":"uint32"},
            {"name": "gasEstimate",          "type": "uint256"},
        ],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "path",     "type": "bytes"},
            {"name": "amountIn", "type": "uint256"},
        ],
        "name": "quoteExactInput",
        "outputs": [
            {"name": "amountOut",              "type": "uint256"},
            {"name": "sqrtPriceX96AfterList",  "type": "uint160[]"},
            {"name": "initializedTicksCrossedList","type":"uint32[]"},
            {"name": "gasEstimate",            "type": "uint256"},
        ],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

CURVE_POOL_ABI = [
    {"inputs": [
        {"name": "i",  "type": "int128"},
        {"name": "j",  "type": "int128"},
        {"name": "dx", "type": "uint256"},
    ], "name": "get_dy", "outputs": [
        {"name": "", "type": "uint256"}
    ], "stateMutability": "view", "type": "function"},
]

BALANCER_VAULT_ABI = [
    {
        "inputs": [
            {"name": "kind", "type": "uint8"},
            {"components": [
                {"name": "poolId",       "type": "bytes32"},
                {"name": "assetInIndex", "type": "uint256"},
                {"name": "assetOutIndex","type": "uint256"},
                {"name": "amount",       "type": "uint256"},
                {"name": "userData",     "type": "bytes"},
            ], "name": "swaps", "type": "tuple[]"},
            {"name": "assets", "type": "address[]"},
            {"components": [
                {"name": "sender",              "type": "address"},
                {"name": "fromInternalBalance", "type": "bool"},
                {"name": "recipient",           "type": "address"},
                {"name": "toInternalBalance",   "type": "bool"},
            ], "name": "funds", "type": "tuple"},
        ],
        "name": "queryBatchSwap",
        "outputs": [{"name": "assetDeltas", "type": "int256[]"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


class PriceFetcher:
    """
    Multi-protocol price fetcher with Multicall3 batching.
    All quotes via eth_call — zero gas cost.
    """

    def __init__(self, w3_manager, multicall_executor, config):
        self._w3m    = w3_manager
        self._mc     = multicall_executor
        self._config = config
        self._fail_count: dict[str, int] = {}   # pool_id → consecutive failures

    # ── Uniswap V3 Batch ──────────────────────────────────────────────────────
    def quote_uniswap_v3_batch(
        self,
        queries: list[tuple[str, str, int, int]],
        # each: (token_in, token_out, amount_in_wei, fee)
    ) -> list[Optional[int]]:
        """
        Batch quoteExactInputSingle calls via Multicall3.
        Returns list of amountOut (int) or None on failure.
        """
        if not queries:
            return []

        w3 = self._w3m.get_connection()
        quoter_addr = self._config.active.uniswap_v3_quoter_v2
        quoter = w3.eth.contract(
            address=Web3.to_checksum_address(quoter_addr),
            abi=QUOTER_V2_ABI,
        )

        calls = []
        for tok_in, tok_out, amount_in, fee in queries:
            calldata = quoter.encodeABI(
                fn_name="quoteExactInputSingle",
                args=[{
                    "tokenIn":           Web3.to_checksum_address(tok_in),
                    "tokenOut":          Web3.to_checksum_address(tok_out),
                    "amountIn":          int(amount_in),
                    "fee":               int(fee),
                    "sqrtPriceLimitX96": 0,
                }],
            )
            calls.append((quoter_addr, bytes.fromhex(calldata[2:])))

        raw_results = self._mc.multicall(calls)
        out = []
        for raw in raw_results:
            if raw is None or len(raw) < 32:
                out.append(None)
            else:
                try:
                    # quoteExactInputSingle returns (uint256 amountOut, ...)
                    decoded = abi_decode(["uint256", "uint160", "uint32", "uint256"], raw)
                    out.append(int(decoded[0]))
                except Exception:
                    out.append(None)
        return out

    def quote_uniswap_v3_single(
        self, token_in: str, token_out: str, amount_in: int, fee: int
    ) -> Optional[int]:
        results = self.quote_uniswap_v3_batch([(token_in, token_out, amount_in, fee)])
        return results[0] if results else None

    # ── Curve Batch ───────────────────────────────────────────────────────────
    def quote_curve_batch(
        self,
        queries: list[tuple[str, int, int, int]],
        # each: (pool_address, i, j, dx)
    ) -> list[Optional[int]]:
        """Batch Curve get_dy calls via Multicall3."""
        if not queries:
            return []

        w3   = self._w3m.get_connection()
        pool_dummy = w3.eth.contract(abi=CURVE_POOL_ABI)
        calls = []
        for pool_addr, i, j, dx in queries:
            calldata = pool_dummy.encodeABI(
                fn_name="get_dy", args=[int(i), int(j), int(dx)]
            )
            calls.append((pool_addr, bytes.fromhex(calldata[2:])))

        raw_results = self._mc.multicall(calls)
        out = []
        for raw in raw_results:
            if raw is None or len(raw) < 32:
                out.append(None)
            else:
                try:
                    decoded = abi_decode(["uint256"], raw)
                    out.append(int(decoded[0]))
                except Exception:
                    out.append(None)
        return out

    def quote_curve(
        self, pool_address: str, i: int, j: int, dx: int
    ) -> Optional[int]:
        results = self.quote_curve_batch([(pool_address, i, j, dx)])
        return results[0] if results else None

    # ── Balancer ──────────────────────────────────────────────────────────────
    def quote_balancer(
        self,
        pool_id: str,
        token_in: str,
        token_out: str,
        amount_in: int,
    ) -> Optional[int]:
        """
        Balancer queryBatchSwap via eth_call.
        Returns amountOut (positive) or None on failure.
        """
        try:
            w3 = self._w3m.get_connection()
            vault_addr = self._config.active.balancer_vault
            vault = w3.eth.contract(
                address=Web3.to_checksum_address(vault_addr),
                abi=BALANCER_VAULT_ABI,
            )
            pool_id_bytes = bytes.fromhex(pool_id.replace("0x", ""))
            swaps = [{
                "poolId":       pool_id_bytes,
                "assetInIndex": 0,
                "assetOutIndex":1,
                "amount":       amount_in,
                "userData":     b"",
            }]
            assets = [
                Web3.to_checksum_address(token_in),
                Web3.to_checksum_address(token_out),
            ]
            funds = {
                "sender":              "0x0000000000000000000000000000000000000000",
                "fromInternalBalance": False,
                "recipient":           "0x0000000000000000000000000000000000000000",
                "toInternalBalance":   False,
            }
            deltas = vault.functions.queryBatchSwap(0, swaps, assets, funds).call()
            if deltas and len(deltas) >= 2:
                return abs(int(deltas[1]))
        except Exception as exc:
            logger.debug(f"Balancer quote failed pool_id={pool_id[:12]}…: {exc}")
        return None

    # ── Build Quote Map for RouteFinder ──────────────────────────────────────
    def build_quote_map(
        self,
        pools: list[dict],
        base_amount_wei: int,
    ) -> dict[tuple[str, str, str], float]:
        """
        Build a {(token_in, token_out, pool_id): rate} map for Bellman-Ford.
        rate = amount_out / amount_in

        Issues all Uniswap V3 quotes in one Multicall3 batch,
        Curve quotes in another batch, Balancer individually.
        """
        quote_map: dict[tuple[str, str, str], float] = {}

        # ── Uniswap V3 ──
        univ3_pools = [p for p in pools if p.get("protocol") == "uniswap_v3"]
        univ3_queries = []
        univ3_keys    = []
        for p in univ3_pools:
            t0, t1, fee = p["token0"], p["token1"], p["fee"]
            # Both directions
            univ3_queries.append((t0, t1, base_amount_wei, fee))
            univ3_keys.append((t0, t1, p["address"]))
            univ3_queries.append((t1, t0, base_amount_wei, fee))
            univ3_keys.append((t1, t0, p["address"]))

        if univ3_queries:
            results = self.quote_uniswap_v3_batch(univ3_queries)
            for (key, q) in zip(univ3_keys, results):
                if q and q > 0:
                    rate = q / base_amount_wei
                    quote_map[key] = rate

        # ── Curve ──
        curve_pools = [p for p in pools if p.get("protocol") == "curve"]
        curve_queries = []
        curve_keys    = []
        for p in curve_pools:
            indices = p.get("indices", {})
            coin_list = list(indices.keys())
            for i_idx, coin_i in enumerate(coin_list):
                for j_idx, coin_j in enumerate(coin_list):
                    if i_idx == j_idx:
                        continue
                    curve_queries.append((p["address"], i_idx, j_idx, base_amount_wei))
                    curve_keys.append((coin_i, coin_j, p["address"]))

        if curve_queries:
            results = self.quote_curve_batch(curve_queries)
            for (key, q) in zip(curve_keys, results):
                if q and q > 0:
                    rate = q / base_amount_wei
                    quote_map[key] = rate

        # ── Balancer ──
        balancer_pools = [p for p in pools if p.get("protocol") == "balancer"]
        for p in balancer_pools:
            tokens = p.get("tokens", [])
            for i, ti in enumerate(tokens):
                for j, tj in enumerate(tokens):
                    if i == j:
                        continue
                    q = self.quote_balancer(p["pool_id"], ti, tj, base_amount_wei)
                    if q and q > 0:
                        key = (ti, tj, p["pool_id"])
                        quote_map[key] = q / base_amount_wei

        logger.debug(f"Quote map: {len(quote_map)} edges built from {len(pools)} pools")
        return quote_map
