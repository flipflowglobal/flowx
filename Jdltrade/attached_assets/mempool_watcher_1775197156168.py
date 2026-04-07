"""
scanner/mempool_watcher.py
==========================
Monitors pending transaction pool for large swaps threatening pool prices.
Enables the scorer to apply 3× slippage penalty to threatened routes.
"""

from __future__ import annotations
import logging
import threading
import time
from collections import deque
from web3 import Web3

logger = logging.getLogger(__name__)

UNISWAP_SWAP_SELECTORS = {
    "0x414bf389", "0xc04b8d59", "0xdb3e2198", "0x09b81346",
}
LARGE_SWAP_ETH = 10.0


class MempoolWatcher:
    def __init__(self, w3_manager, config):
        self._w3m     = w3_manager
        self._config  = config
        self._pending: deque = deque(maxlen=500)
        self._lock    = threading.Lock()
        self._running = False
        self._thread: threading.Thread = None

    def start(self):
        self._running = True
        self._thread  = threading.Thread(target=self._poll_loop, name="mempool-watcher", daemon=True)
        self._thread.start()
        logger.info("MempoolWatcher started")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _poll_loop(self):
        w3 = self._w3m.get_connection()
        try:
            f = w3.eth.filter("pending")
        except Exception as e:
            logger.warning(f"MempoolWatcher: cannot create pending filter: {e}")
            return
        while self._running:
            try:
                for tx_hash in f.get_new_entries()[:50]:
                    self._inspect_tx(w3, Web3.to_hex(tx_hash))
            except Exception as e:
                logger.debug(f"Mempool poll error: {e}")
                time.sleep(1)
                try:
                    f = w3.eth.filter("pending")
                except Exception:
                    pass
            time.sleep(0.5)

    def _inspect_tx(self, w3, tx_hash: str):
        try:
            tx = w3.eth.get_transaction(tx_hash)
        except Exception:
            return
        if not tx or not tx.get("input") or len(tx["input"]) < 10:
            return
        selector = tx["input"][:10]
        if selector not in UNISWAP_SWAP_SELECTORS:
            return
        value_eth = float(Web3.from_wei(tx.get("value", 0), "ether"))
        if value_eth < LARGE_SWAP_ETH:
            return
        with self._lock:
            self._pending.append({
                "ts": time.monotonic(),
                "to": (tx.get("to") or "").lower(),
                "value_eth": value_eth,
            })

    def get_pending_large_swaps(self, max_age: float = 30.0) -> list[dict]:
        now = time.monotonic()
        with self._lock:
            return [p for p in self._pending if now - p["ts"] <= max_age]

    def pool_is_threatened(self, pool_address: str, max_age: float = 15.0) -> bool:
        pl = pool_address.lower()
        return any(s["to"] == pl for s in self.get_pending_large_swaps(max_age))
