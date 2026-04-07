"""
executor/execution_router.py
===========================
Production-grade trade execution manager.
Handles nonce management, concurrent trade routing, and atomic execution.
"""

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class ExecutionRouter:
    """
    Orchestrates the submission of flash loan transactions.
    Ensures sequential execution and manages account state.
    """

    def __init__(self, executor, config):
        self._executor = executor
        self._config   = config
        self._lock     = asyncio.Lock()
        self._nonce    = None

    # ── Submit Trade ──────────────────────────────────────────────────────────
    async def submit_trade(
        self,
        route: list[dict],
        recommended_loan_usd: float,
    ) -> Optional[str]:
        """
        Submits a flash loan trade to the executor.
        Uses a lock to ensure sequential execution and prevent nonce collisions.
        """
        async with self._lock:
            try:
                # 1. Calculate loan amount in wei
                # Assume loan asset is WETH (18 decimals)
                weth_price_usd = 2500.0  # Should be fetched from price_fetcher
                loan_amount_wei = int((recommended_loan_usd / weth_price_usd) * 1e18)
                
                # 2. Get current gas price
                w3 = self._executor._w3m.get_connection()
                gas_price_wei = w3.eth.gas_price
                
                # 3. Initiate flash loan
                tx_hash = await self._executor.execute_flash_loan(
                    asset=self._config.active.weth,
                    amount_wei=loan_amount_wei,
                    route=route,
                    gas_price_wei=gas_price_wei
                )
                
                if tx_hash:
                    logger.info(f"ExecutionRouter: Trade submitted. Hash: {tx_hash}")
                    return tx_hash
                else:
                    logger.warning("ExecutionRouter: Flash loan initiation failed.")
                    return None

            except Exception as exc:
                logger.error(f"ExecutionRouter: Trade submission error: {exc}")
                return None

    # ── Nonce Management ──────────────────────────────────────────────────────
    async def _get_nonce(self) -> int:
        """Fetch the current nonce for the deployer account."""
        w3 = self._executor._w3m.get_connection()
        if self._nonce is None:
            self._nonce = w3.eth.get_transaction_count(self._executor._account.address)
        else:
            self._nonce += 1
        return self._nonce
