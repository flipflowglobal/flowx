"""
database/db_manager.py
=======================
Async SQLite manager (aiosqlite) with WAL mode, full CRUD, and stats queries.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)


class DatabaseManager:
    def __init__(self, db_path: str = "nexus_arb.db"):
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def initialize(self):
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        schema = (Path(__file__).parent / "schema.sql").read_text()
        await self._db.executescript(schema)
        await self._db.commit()
        logger.info(f"DB initialized: {self.db_path}")

    async def close(self):
        if self._db:
            await self._db.close()

    # ── Opportunities ─────────────────────────────────────────────────────────
    async def insert_opportunity(self, opp: dict) -> int:
        cur = await self._db.execute(
            """INSERT INTO opportunities
               (chain_id,route_hash,token_in,loan_amount_wei,expected_profit_usd,
                profit_std_usd,profit_p10_usd,profit_p50_usd,profit_p90_usd,
                profit_probability,viability_probability,gas_estimate_gwei,
                composite_score,kelly_fraction,status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                opp.get("chain_id", 1),
                opp.get("route_hash", ""),
                opp.get("token_in", ""),
                str(opp.get("loan_amount_wei", 0)),
                opp.get("expected_profit_usd", 0.0),
                opp.get("profit_std_usd", 0.0),
                opp.get("profit_p10_usd", 0.0),
                opp.get("profit_p50_usd", 0.0),
                opp.get("profit_p90_usd", 0.0),
                opp.get("profit_probability", 0.0),
                opp.get("viability_probability", 0.0),
                opp.get("gas_estimate_gwei", 0.0),
                opp.get("composite_score", 0.0),
                opp.get("kelly_fraction"),
                "detected",
            ),
        )
        await self._db.commit()
        opp["id"] = cur.lastrowid
        return cur.lastrowid

    async def insert_ai_decision(self, opportunity_id: int, decision: dict):
        scores  = decision.get("engine_scores", {})
        weights = decision.get("weights", {})
        await self._db.execute(
            """INSERT INTO ai_decisions
               (opportunity_id,ppo_score,thompson_score,ukf_score,cma_es_score,
                composite_score,ppo_weight,thompson_weight,ukf_weight,cma_es_weight,
                decision,recommended_loan_usd,reasoning)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                opportunity_id,
                scores.get("ppo", 0.0),
                scores.get("thompson", 0.0),
                scores.get("ukf", 0.0),
                scores.get("cma_es", 0.0),
                decision.get("composite_score", 0.0),
                weights.get("ppo", 0.25),
                weights.get("thompson", 0.25),
                weights.get("ukf", 0.25),
                weights.get("cma_es", 0.25),
                "execute" if decision.get("execute") else "skip",
                decision.get("recommended_loan_usd", 0.0),
                decision.get("reasoning", ""),
            ),
        )
        await self._db.commit()

    async def update_trade(self, opportunity_id: int, result: dict):
        await self._db.execute(
            """INSERT OR REPLACE INTO trades
               (opportunity_id,chain_id,tx_hash,token,loan_amount_wei,
                gross_profit_wei,gas_cost_wei,net_profit_wei,net_profit_usd,
                status,block_number,gas_used,inclusion_blocks,confirmed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                opportunity_id,
                result.get("chain_id", 1),
                result.get("tx_hash"),
                result.get("token", ""),
                str(result.get("loan_amount_wei", 0)),
                str(result.get("gross_profit_wei", 0)),
                str(result.get("gas_cost_wei", 0)),
                str(result.get("net_profit_wei", 0)),
                result.get("net_profit_usd", 0.0),
                result.get("status", "confirmed"),
                result.get("block_number"),
                result.get("gas_used"),
                result.get("inclusion_blocks"),
                int(time.time()),
            ),
        )
        await self._db.commit()

    async def record_failed_trade(self, opportunity_id: int, reason: str):
        await self._db.execute(
            """INSERT INTO trades (opportunity_id,chain_id,token,loan_amount_wei,status,revert_reason)
               VALUES (?,?,?,?,?,?)""",
            (opportunity_id, 1, "", "0", "reverted", reason[:500]),
        )
        await self._db.commit()

    async def get_recent_trades(self, limit: int = 50) -> list[dict]:
        async with self._db.execute(
            "SELECT * FROM trades ORDER BY created_at DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_trade_stats(self) -> dict:
        async with self._db.execute("""
            SELECT
                COUNT(*)                                           AS total_trades,
                SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
                SUM(CASE WHEN status IN ('reverted','failed') THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN net_profit_usd > 0 THEN 1 ELSE 0 END) AS profitable,
                COALESCE(SUM(net_profit_usd), 0)                   AS total_profit_usd,
                COALESCE(AVG(net_profit_usd), 0)                   AS avg_profit_usd,
                COALESCE(MAX(net_profit_usd), 0)                   AS best_trade_usd,
                COALESCE(MIN(net_profit_usd), 0)                   AS worst_trade_usd
            FROM trades WHERE status IN ('confirmed','reverted','failed')
        """) as cur:
            row = await cur.fetchone()
        stats = dict(row) if row else {}
        confirmed = stats.get("confirmed") or 0
        profitable = stats.get("profitable") or 0
        stats["win_rate"] = (profitable / confirmed) if confirmed > 0 else 0.0
        return stats

    async def get_recent_opportunities(self, limit: int = 100, min_score: float = 0.0) -> list[dict]:
        async with self._db.execute(
            "SELECT * FROM opportunities WHERE composite_score >= ? ORDER BY created_at DESC LIMIT ?",
            (min_score, limit),
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def save_engine_weights(self, weights: dict, shapley: dict, n_trades: int):
        await self._db.execute(
            """INSERT INTO engine_weights
               (ppo_weight,thompson_weight,ukf_weight,cma_es_weight,trades_evaluated,shapley_values_json)
               VALUES (?,?,?,?,?,?)""",
            (
                weights.get("ppo", 0.25),
                weights.get("thompson", 0.25),
                weights.get("ukf", 0.25),
                weights.get("cma_es", 0.25),
                n_trades,
                json.dumps(shapley),
            ),
        )
        await self._db.commit()

    async def get_latest_engine_weights(self) -> Optional[dict]:
        async with self._db.execute(
            "SELECT * FROM engine_weights ORDER BY recorded_at DESC LIMIT 1"
        ) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    async def set_system_stat(self, key: str, value: str):
        await self._db.execute(
            "INSERT OR REPLACE INTO system_stats (stat_key, stat_value, recorded_at) VALUES (?,?,?)",
            (key, value, int(time.time())),
        )
        await self._db.commit()

    async def get_system_stat(self, key: str) -> Optional[str]:
        async with self._db.execute(
            "SELECT stat_value FROM system_stats WHERE stat_key=?", (key,)
        ) as cur:
            row = await cur.fetchone()
        return row[0] if row else None
