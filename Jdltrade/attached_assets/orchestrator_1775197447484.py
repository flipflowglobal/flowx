"""
engine/orchestrator.py
=======================
Central coordination loop for NEXUS-ARB.

Concurrency model:
  - Scanning: asyncio tasks + ThreadPoolExecutor for CPU-bound numpy ops
  - Execution: serialised by asyncio.Lock (one active trade at a time)
  - AI updates: ThreadPoolExecutor (never block the event loop)
  - DB writes: fully async (aiosqlite)
  - Pool refresh: background task every 300s
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import time
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_POOL_REFRESH_INTERVAL = 300.0   # seconds


class NexusOrchestrator:
    def __init__(
        self,
        config,
        db,
        pool_registry,
        price_fetcher,
        route_finder,
        scorer,
        brain,
        flash_executor,
        execution_router,
        tx_monitor,
        circuit_breaker,
        dry_run: bool = False,
        scan_only: bool = False,
    ):
        self.config           = config
        self.db               = db
        self.pool_registry    = pool_registry
        self.price_fetcher    = price_fetcher
        self.route_finder     = route_finder
        self.scorer           = scorer
        self.brain            = brain
        self.flash_executor   = flash_executor
        self.execution_router = execution_router
        self.tx_monitor       = tx_monitor
        self.circuit_breaker  = circuit_breaker
        self.dry_run          = dry_run
        self.scan_only        = scan_only

        self._exec_lock         = asyncio.Lock()
        self._scan_count        = 0
        self._start_time        = time.monotonic()
        self._last_pool_refresh = 0.0
        self._eth_price         = 2500.0
        self._recent_trades: list[dict] = []

        # Shared broadcast queue for WebSocket
        self.broadcast_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

    # ── Main Loop ─────────────────────────────────────────────────────────────
    async def run(self, shutdown_event: asyncio.Event):
        logger.info("Orchestrator started")
        await self._refresh_pools()

        # Background ETH price refresh
        asyncio.create_task(self._price_refresh_loop(shutdown_event))

        while not shutdown_event.is_set():
            cycle_start = time.monotonic()
            try:
                await self._scan_cycle()
            except Exception as exc:
                logger.error(f"Scan cycle error: {exc}", exc_info=True)

            if time.monotonic() - self._last_pool_refresh > _POOL_REFRESH_INTERVAL:
                asyncio.create_task(self._refresh_pools())

            elapsed_ms = (time.monotonic() - cycle_start) * 1000
            sleep_ms   = max(0, self.config.scan_interval_ms - elapsed_ms)
            await asyncio.sleep(sleep_ms / 1000)

        logger.info("Orchestrator stopped")

    # ── Pool Refresh ──────────────────────────────────────────────────────────
    async def _refresh_pools(self):
        loop = asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            await loop.run_in_executor(pool, self.pool_registry.refresh)
        self._last_pool_refresh = time.monotonic()
        logger.info(f"Pools refreshed: {len(self.pool_registry.all_pools())}")

    # ── ETH Price Background Refresh ──────────────────────────────────────────
    async def _price_refresh_loop(self, shutdown_event: asyncio.Event):
        while not shutdown_event.is_set():
            try:
                loop = asyncio.get_running_loop()
                with concurrent.futures.ThreadPoolExecutor(maxsize=1) as pool:
                    pass  # inline below
                w3 = self.price_fetcher._w3m.get_connection()
                CHAINLINK  = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
                ABI = [{"inputs":[],"name":"latestRoundData","outputs":[
                    {"name":"roundId","type":"uint80"},{"name":"answer","type":"int256"},
                    {"name":"startedAt","type":"uint256"},{"name":"updatedAt","type":"uint256"},
                    {"name":"answeredInRound","type":"uint80"}
                ],"stateMutability":"view","type":"function"}]
                from web3 import Web3
                c   = w3.eth.contract(address=Web3.to_checksum_address(CHAINLINK), abi=ABI)
                ans = await asyncio.get_running_loop().run_in_executor(
                    None, lambda: c.functions.latestRoundData().call()
                )
                self._eth_price = ans[1] / 1e8
            except Exception:
                pass
            await asyncio.sleep(30)

    # ── Scan Cycle ────────────────────────────────────────────────────────────
    async def _scan_cycle(self):
        self._scan_count += 1
        loop = asyncio.get_running_loop()
        pools = self.pool_registry.all_pools()
        if not pools:
            return

        base_amount = int((self.config.min_loan_usd / self._eth_price) * 1e18)

        # Build quote map in thread pool (blocking eth_call batches)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            quote_map = await loop.run_in_executor(
                pool,
                lambda: self.price_fetcher.build_quote_map(pools, base_amount),
            )

        if not quote_map:
            logger.debug(f"Cycle {self._scan_count}: empty quote map")
            return

        # Find cycles via Bellman-Ford
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            cycles = await loop.run_in_executor(
                pool,
                lambda: self.route_finder.find_arbitrage_cycles(
                    self.config.active.weth,
                    max_hops=4,
                    quote_map=quote_map,
                ),
            )

        if not cycles:
            logger.debug(f"Cycle {self._scan_count}: no cycles detected")
            return

        # Score top routes via Monte Carlo (parallel)
        loan_wei = self._kelly_loan_wei()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            score_tasks = [
                loop.run_in_executor(
                    pool,
                    lambda c=cyc: self.scorer.score_route(c, loan_wei, self._eth_price),
                )
                for cyc in cycles[:self.config.max_concurrent_routes]
            ]
            scored = await asyncio.gather(*score_tasks)

        viable = sorted(
            [s for s in scored if s.get("viable")],
            key=lambda x: x["expected_profit_usd"],
            reverse=True,
        )

        logger.info(
            f"Cycle {self._scan_count}: {len(cycles)} cycles | "
            f"{len(viable)} viable | "
            f"best=${viable[0]['expected_profit_usd']:.4f}±{viable[0]['profit_std_usd']:.4f}"
            if viable else
            f"Cycle {self._scan_count}: {len(cycles)} cycles | 0 viable"
        )

        # Persist top opportunities
        for opp in viable[:5]:
            await self.db.insert_opportunity(opp)

        if not viable:
            return

        best = viable[0]
        market_ctx = await self._build_market_context()

        # AI evaluation
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            ai_decision = await loop.run_in_executor(
                pool,
                lambda: self.brain.evaluate(best, market_ctx),
            )

        best["composite_score"] = ai_decision["composite_score"]
        await self.db.insert_ai_decision(best.get("id", 0), ai_decision)

        # Broadcast to WebSocket clients
        await self._broadcast("opportunity_scored", {
            "opportunity": {
                k: best[k] for k in
                ["route_hash","expected_profit_usd","profit_std_usd",
                 "profit_probability","composite_score","gas_estimate_gwei"]
            },
            "ai_decision": ai_decision,
        })

        # Execute
        if ai_decision["execute"] and not self.scan_only and not self.dry_run:
            if self.circuit_breaker.check():
                async with self._exec_lock:
                    await self._execute(best, ai_decision)
            else:
                logger.warning(f"CircuitBreaker {self.circuit_breaker.state} — skipped")
        elif self.dry_run and ai_decision["execute"]:
            logger.info(
                f"[DRY RUN] Would execute: "
                f"${ai_decision['recommended_loan_usd']:.0f} loan | "
                f"score={ai_decision['composite_score']:.3f}"
            )

    # ── Execute ───────────────────────────────────────────────────────────────
    async def _execute(self, opportunity: dict, ai_decision: dict):
        route   = opportunity["route"]
        loan_wei = self._kelly_loan_wei(ai_decision.get("recommended_loan_usd"))

        # Compute per-step min_amounts_out with slippage
        min_outs = self._compute_min_outs(route, loan_wei)
        calldata = self.execution_router.encode_route(route, min_outs)

        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self.flash_executor.execute(
                    token=self.config.active.weth,
                    amount=loan_wei,
                    route_calldata=calldata,
                    target_inclusion_blocks=1,
                ),
            )

            await self.db.update_trade(opportunity.get("id", 0), result)

            # Update AI brain with outcome
            loop.call_soon_threadsafe(
                lambda: self.brain.record_outcome(
                    opportunity.get("id", 0),
                    result["net_profit_usd"],
                )
            )

            logger.info(
                f"TRADE CONFIRMED: {result['tx_hash'][:12]}… "
                f"profit=${result['net_profit_usd']:.4f} "
                f"gas=${result['gas_cost_usd']:.4f}"
            )

            # Update recent trades cache
            self._recent_trades.insert(0, result)
            self._recent_trades = self._recent_trades[:200]

            await self._broadcast("trade_executed", result)

        except Exception as exc:
            logger.error(f"Execution failed: {exc}", exc_info=True)
            await self.db.record_failed_trade(opportunity.get("id", 0), str(exc))
            await self._broadcast("circuit_breaker", {
                "state": self.circuit_breaker.state,
                "reason": str(exc),
            })

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _kelly_loan_wei(self, recommended_usd: Optional[float] = None) -> int:
        usd = recommended_usd or self.circuit_breaker.get_recommended_loan_size(
            self._recent_trades, self.config.max_loan_usd
        )
        if usd <= 0:
            usd = self.config.min_loan_usd
        eth = usd / max(self._eth_price, 1.0)
        return int(eth * 1e18)

    def _compute_min_outs(self, route: list[dict], loan_wei: int) -> list[int]:
        slip = self.config.slippage_bps / 10000
        amounts = [loan_wei]
        for step in route:
            rate    = step.get("rate", 1.0)
            raw_out = int(amounts[-1] * rate)
            min_out = int(raw_out * (1 - slip))
            amounts.append(min_out)
        return amounts[1:]

    async def _build_market_context(self) -> dict:
        import time as _time
        recent = self._recent_trades[:50]
        wins   = sum(1 for t in recent[:5]  if (t.get("net_profit_usd") or 0) > 0)
        wins20 = sum(1 for t in recent[:20] if (t.get("net_profit_usd") or 0) > 0)
        n5  = len(recent[:5])  or 1
        n20 = len(recent[:20]) or 1
        kelly = self.circuit_breaker.compute_kelly_fraction(recent)
        return {
            "gas_gwei":       self.price_fetcher._gas.get_gas_price_gwei()
                               if hasattr(self.price_fetcher, "_gas") else 30.0,
            "hour_utc":       _time.gmtime().tm_hour,
            "win_rate_5":     wins  / n5,
            "win_rate_20":    wins20 / n20,
            "price_volatility": self._compute_volatility(recent),
            "recent_trades":  recent,
            "kelly_fraction": kelly,
            "max_loan_usd":   self.config.max_loan_usd,
        }

    def _compute_volatility(self, trades: list[dict]) -> float:
        if len(trades) < 5:
            return 0.02
        profits = np.array([t.get("net_profit_usd") or 0 for t in trades[:20]])
        mean    = profits.mean()
        return float(profits.std() / (abs(mean) + 1e-9))

    async def _broadcast(self, event_type: str, payload: dict):
        try:
            self.broadcast_queue.put_nowait({"type": event_type, "payload": payload, "ts": int(time.time())})
        except asyncio.QueueFull:
            pass

    # ── Status ────────────────────────────────────────────────────────────────
    def get_status(self) -> dict:
        return {
            "state":           "running",
            "uptime_seconds":  time.monotonic() - self._start_time,
            "scan_count":      self._scan_count,
            "circuit_breaker": self.circuit_breaker.state,
            "eth_price_usd":   self._eth_price,
            "dry_run":         self.dry_run,
            "scan_only":       self.scan_only,
            "pools_loaded":    len(self.pool_registry.all_pools()),
        }
