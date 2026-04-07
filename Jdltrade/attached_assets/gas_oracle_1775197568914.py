"""
core/gas_oracle.py
==================
EIP-1559 fee estimation using 90th-percentile priority fee over 10 blocks.

Algorithm (MetaMask "fast" tier methodology):
  1. Fetch eth_feeHistory(10, "latest", [90]) — 90th pct priority fee per block
  2. Take median of those 10 values → max_priority_fee
  3. base_fee = latest block baseFeePerGas
  4. max_fee  = base_fee * 2 + max_priority_fee  (2× buffer ensures inclusion)

Base fee update rule (EIP-1559):
  next_base = current_base * (1 ± 0.125 * block_utilization_deviation)

Optimal bid for target_blocks inclusion:
  max_fee(1) = base * 1.125 + tip
  max_fee(2) = base * 1.125^0.5 + tip  (expected base after 2 blocks)
"""

from __future__ import annotations

import logging
import math
import statistics
import time
from typing import Optional

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 3.0
_GAS_BUFFER_FACTOR = 1.20   # 20% buffer on estimate


class GasOracle:

    def __init__(self, w3_manager):
        self._w3  = w3_manager
        self._cache_ts: float    = 0.0
        self._cached_base: int   = 0
        self._cached_tip:  int   = 0

    # ── EIP-1559 Fee Estimation ───────────────────────────────────────────────
    def get_eip1559_fees(
        self, target_blocks: int = 1
    ) -> tuple[int, int]:
        """
        Returns (max_fee_per_gas_wei, max_priority_fee_per_gas_wei).

        Optimal bid formula for `target_blocks` inclusion:
            expected_base = current_base * 1.125 ^ (1 / target_blocks)
            max_fee       = expected_base * 2 + priority_fee
        """
        now = time.monotonic()
        if now - self._cache_ts < _CACHE_TTL_SECONDS:
            base, tip = self._cached_base, self._cached_tip
        else:
            base, tip = self._fetch_fees()
            self._cached_base = base
            self._cached_tip  = tip
            self._cache_ts    = now

        # Expected base fee after target_blocks using EIP-1559 update formula
        # base_{t+k} ≈ base_t * (1.125)^(k * utilization_factor)
        # Conservative: assume full blocks → maximum increase each block
        expected_base = int(base * (1.125 ** (1.0 / max(1, target_blocks))))
        max_fee = expected_base * 2 + tip
        return max_fee, tip

    def _fetch_fees(self) -> tuple[int, int]:
        """Fetch fee history and compute median 90th-pct priority fee."""
        try:
            w3 = self._w3.get_connection()
            fee_history = w3.eth.fee_history(
                block_count=10,
                newest_block="latest",
                reward_percentiles=[90]
            )
            # reward[i][0] = 90th percentile tip for block i
            tips = [r[0] for r in fee_history.get("reward", []) if r and r[0] > 0]
            tip  = int(statistics.median(tips)) if tips else int(1e9)   # fallback 1 gwei

            base_fees = fee_history.get("baseFeePerGas", [])
            base = int(base_fees[-1]) if base_fees else int(20e9)

            logger.debug(f"GasOracle: base={base/1e9:.2f}gwei tip={tip/1e9:.2f}gwei")
            return base, tip

        except Exception as exc:
            logger.warning(f"GasOracle fee_history failed: {exc}. Using fallback.")
            # Fallback: eth_gasPrice
            try:
                w3 = self._w3.get_connection()
                gp = w3.eth.gas_price
                return int(gp * 0.85), int(gp * 0.15)
            except Exception:
                return int(30e9), int(2e9)

    # ── Gas Estimation ────────────────────────────────────────────────────────
    def estimate_gas(self, tx_dict: dict) -> int:
        """eth_estimateGas + 20% safety buffer (ceiling)."""
        try:
            w3 = self._w3.get_connection()
            estimate = w3.eth.estimate_gas(tx_dict)
            return math.ceil(estimate * _GAS_BUFFER_FACTOR)
        except Exception as exc:
            logger.warning(f"Gas estimation failed: {exc}. Using 400_000 fallback.")
            return 400_000

    # ── Helpers ───────────────────────────────────────────────────────────────
    def get_gas_price_gwei(self) -> float:
        """Current base fee in Gwei."""
        now = time.monotonic()
        if now - self._cache_ts < _CACHE_TTL_SECONDS and self._cached_base:
            return self._cached_base / 1e9
        try:
            base, _ = self._fetch_fees()
            return base / 1e9
        except Exception:
            return 30.0

    def is_gas_acceptable(self, max_gwei: float) -> bool:
        """True if current base fee ≤ max_gwei threshold."""
        return self.get_gas_price_gwei() <= max_gwei

    def gas_cost_usd(self, gas_units: int, eth_price_usd: float) -> float:
        """Compute gas cost in USD given estimated gas units and ETH price."""
        max_fee, _ = self.get_eip1559_fees()
        cost_wei   = gas_units * max_fee
        cost_eth   = cost_wei / 1e18
        return cost_eth * eth_price_usd
