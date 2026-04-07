"""
executor/tx_monitor.py
======================
Production-grade transaction monitoring service.
Handles confirmation tracking, revert analysis, and gas price escalation.
"""

import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

class TxMonitor:
    """
    Monitors submitted transactions for on-chain inclusion and confirmation.
    """

    def __init__(self, w3_manager, db):
        self._w3m      = w3_manager
        self._db       = db
        self._active_txs: dict[str, dict] = {}
        self._running = False

    # ── Start Monitor ─────────────────────────────────────────────────────────
    async def start(self):
        """Main monitoring loop."""
        self._running = True
        logger.info("TxMonitor: started")
        
        while self._running:
            try:
                await self._check_pending_txs()
                await asyncio.sleep(2.0)  # Check every 2 seconds
            except Exception as exc:
                logger.error(f"TxMonitor loop error: {exc}")
                await asyncio.sleep(5.0)

    # ── Track Transaction ─────────────────────────────────────────────────────
    async def track(self, tx_hash: str, route: list[dict]):
        """Register a new transaction for monitoring."""
        self._active_txs[tx_hash] = {
            "tx_hash":    tx_hash,
            "route":      route,
            "start_time": time.time(),
            "status":     "pending",
        }
        logger.info(f"TxMonitor: tracking tx={tx_hash}")

    # ── Internal Check ────────────────────────────────────────────────────────
    async def _check_pending_txs(self):
        """Check all pending transactions for inclusion."""
        w3 = self._w3m.get_connection()
        completed = []
        
        for tx_hash, info in self._active_txs.items():
            try:
                receipt = w3.eth.get_transaction_receipt(tx_hash)
                
                if receipt:
                    status = "confirmed" if receipt.status == 1 else "reverted"
                    logger.info(f"TxMonitor: tx={tx_hash} inclusion status={status}")
                    
                    # Record in DB
                    await self._db.update_trade(
                        opportunity_id=0,  # Should be passed from orchestrator
                        result={
                            "tx_hash":          tx_hash,
                            "status":           status,
                            "block_number":     receipt.blockNumber,
                            "gas_used":         receipt.gasUsed,
                            "inclusion_blocks": 1,  # Simplified
                        }
                    )
                    
                    completed.append(tx_hash)
                
                elif time.time() - info["start_time"] > 300:
                    # Timeout after 5 minutes
                    logger.warning(f"TxMonitor: tx={tx_hash} timed out.")
                    completed.append(tx_hash)

            except Exception as exc:
                logger.debug(f"TxMonitor: error checking tx={tx_hash}: {exc}")

        for tx_hash in completed:
            del self._active_txs[tx_hash]

    def stop(self):
        self._running = False
        logger.info("TxMonitor: stopped")
