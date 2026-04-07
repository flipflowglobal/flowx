"""
core/wallet.py
==============
EIP-1559 transaction builder, signer, and sender.

Nonce management:
  - Synced from chain (eth_getTransactionCount "pending") on first use
  - Incremented optimistically per submission (avoids extra RPC call)
  - Reset to chain state on revert or timeout (reset_nonce())
  - Thread-safe via threading.Lock

Security:
  - Private key held only in eth_account LocalAccount (never logged)
  - Addresses validated as checksummed before use
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import Web3

logger = logging.getLogger(__name__)


class Wallet:

    def __init__(self, private_key: str, w3_manager, gas_oracle):
        self._account: LocalAccount = Account.from_key(private_key)
        self.address: str           = self._account.address
        self._w3m                   = w3_manager
        self._gas                   = gas_oracle
        self._nonce: int            = -1       # -1 = needs sync
        self._lock                  = threading.Lock()
        logger.info(f"Wallet: {self.address}")

    # ── Nonce Management ──────────────────────────────────────────────────────
    def _get_nonce(self) -> int:
        with self._lock:
            if self._nonce < 0:
                w3 = self._w3m.get_connection()
                self._nonce = w3.eth.get_transaction_count(self.address, "pending")
                logger.debug(f"Nonce synced: {self._nonce}")
            n = self._nonce
            self._nonce += 1
            return n

    def reset_nonce(self):
        """Force re-sync from chain. Call after any tx failure."""
        with self._lock:
            self._nonce = -1
        logger.debug("Nonce reset — will re-sync on next tx")

    # ── Balance ───────────────────────────────────────────────────────────────
    def get_eth_balance(self) -> float:
        w3  = self._w3m.get_connection()
        wei = w3.eth.get_balance(self.address)
        return float(Web3.from_wei(wei, "ether"))

    def get_token_balance(self, token_address: str, decimals: int = 18) -> float:
        """Return ERC20 balance as float adjusted for decimals."""
        ERC20_BALANCE_ABI = [{
            "inputs": [{"name": "account", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function",
        }]
        w3  = self._w3m.get_connection()
        tok = w3.eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=ERC20_BALANCE_ABI,
        )
        raw = tok.functions.balanceOf(self.address).call()
        return raw / (10 ** decimals)

    # ── Transaction Building & Signing ────────────────────────────────────────
    def build_and_sign_tx(
        self,
        to: str,
        data: bytes,
        value: int = 0,
        gas_limit: Optional[int] = None,
        max_fee_per_gas: Optional[int] = None,
        max_priority_fee_per_gas: Optional[int] = None,
        target_inclusion_blocks: int = 1,
    ) -> tuple[bytes, str]:
        """
        Build, sign, and return (raw_tx_bytes, tx_hash_hex).

        Gas parameters are fetched from GasOracle if not supplied.
        Raises ValueError if gas price exceeds configured threshold.
        """
        w3 = self._w3m.get_connection()

        if max_fee_per_gas is None or max_priority_fee_per_gas is None:
            max_fee_per_gas, max_priority_fee_per_gas = self._gas.get_eip1559_fees(
                target_blocks=target_inclusion_blocks
            )

        if gas_limit is None:
            gas_limit = self._gas.estimate_gas({
                "from":  self.address,
                "to":    to,
                "data":  data,
                "value": value,
            })

        nonce = self._get_nonce()

        tx = {
            "type":                 "0x2",
            "chainId":              w3.eth.chain_id,
            "nonce":                nonce,
            "to":                   Web3.to_checksum_address(to),
            "value":                value,
            "gas":                  gas_limit,
            "maxFeePerGas":         max_fee_per_gas,
            "maxPriorityFeePerGas": max_priority_fee_per_gas,
            "data":                 data,
        }

        signed  = self._account.sign_transaction(tx)
        raw_tx  = signed.rawTransaction
        tx_hash = Web3.to_hex(Web3.keccak(raw_tx))
        logger.debug(
            f"Tx signed: nonce={nonce} gas={gas_limit} "
            f"maxFee={max_fee_per_gas/1e9:.2f}gwei hash={tx_hash[:12]}…"
        )
        return raw_tx, tx_hash

    def send_raw_transaction(self, raw_tx: bytes) -> str:
        """Broadcast a pre-signed transaction. Returns tx hash hex string."""
        w3      = self._w3m.get_connection()
        tx_hash = w3.eth.send_raw_transaction(raw_tx)
        return Web3.to_hex(tx_hash)
