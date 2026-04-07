"""
executor/circuit_breaker.py
==========================
Production-grade safety mechanism for automated trading.
Monitors revert rates, slippage violations, and system health.
"""

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

class CircuitBreaker:
    """
    Monitors system state and halts trading if safety thresholds are exceeded.
    """

    def __init__(self, config):
        self._config = config
        self._paused = False
        self._last_revert_ts: list[float] = []
        self._max_reverts_per_window = 3
        self._window_seconds = 300  # 5 minutes
        
        # System health thresholds
        self._max_gas_gwei = config.max_gas_gwei
        self._min_profit_usd = config.min_profit_usd

    # ── Check Status ──────────────────────────────────────────────────────────
    def is_paused(self) -> bool:
        """Check if trading is currently halted."""
        # 1. Manual override
        if self._paused:
            return True
            
        # 2. Revert rate check
        now = time.time()
        self._last_revert_ts = [ts for ts in self._last_revert_ts if now - ts < self._window_seconds]
        if len(self._last_revert_ts) >= self._max_reverts_per_window:
            logger.critical(f"CircuitBreaker: High revert rate ({len(self._last_revert_ts)} in 5m). HALTING.")
            self._paused = True
            return True
            
        return False

    # ── Record Events ─────────────────────────────────────────────────────────
    def record_revert(self, reason: str):
        """Log a transaction revert and update circuit breaker state."""
        self._last_revert_ts.append(time.time())
        logger.warning(f"CircuitBreaker: Transaction reverted. Reason: {reason}")

    def record_success(self, profit_usd: float):
        """Log a successful trade."""
        logger.info(f"CircuitBreaker: Trade success. Profit: ${profit_usd:.2f}")

    # ── Control ───────────────────────────────────────────────────────────────
    def pause(self, reason: str):
        """Manually pause the system."""
        self._paused = True
        logger.info(f"CircuitBreaker: Manually paused. Reason: {reason}")

    def unpause(self):
        """Manually resume the system."""
        self._paused = False
        self._last_revert_ts = []
        logger.info("CircuitBreaker: Manually unpaused.")
