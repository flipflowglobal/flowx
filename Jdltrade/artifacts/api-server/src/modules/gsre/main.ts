/**
 * GSRE — Global State Reconciliation Engine
 *
 * Reconciles balances and trade records across all data sources.
 * Detects inconsistencies and emits correction events.
 *
 * Publishes: gsre.reconciled | gsre.inconsistency_detected | gsre.correction_applied
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { ModuleHealth } from "../shared/types.js";
import { query } from "../../services/database.js";

const MODULE = "GSRE";

// ── Reconciliation record ─────────────────────────────────────────────────────

interface Inconsistency {
  type: "balance_mismatch" | "missing_trade" | "duplicate_trade" | "pnl_drift";
  severity: "low" | "medium" | "high";
  description: string;
  agentId?: string;
  detectedAt: string;
  corrected: boolean;
}

const inconsistencies: Inconsistency[] = [];
let totalReconciliations = 0;
let totalInconsistencies = 0;
let totalCorrections = 0;

// ── Core reconciliation logic ──────────────────────────────────────────────────

async function reconcileAgentPnL(): Promise<void> {
  try {
    const result = await query(`
      SELECT
        a.id,
        a.name,
        COALESCE((a.performance->>'pnl')::float, 0)        AS declared_pnl,
        COALESCE(SUM(t.pnl), 0)                            AS computed_pnl,
        COUNT(t.id)                                         AS trade_count
      FROM agents a
      LEFT JOIN trades t ON t.agent_id = a.id
      GROUP BY a.id, a.name, a.performance
    `);

    for (const row of result.rows) {
      const drift = Math.abs(row.declared_pnl - row.computed_pnl);
      const driftPct = row.computed_pnl !== 0 ? drift / Math.abs(row.computed_pnl) : 0;

      if (drift > 1.0 && driftPct > 0.05) {
        const inconsistency: Inconsistency = {
          type: "pnl_drift",
          severity: driftPct > 0.2 ? "high" : "medium",
          description: `Agent ${row.name}: declared PnL $${row.declared_pnl.toFixed(2)} vs computed $${row.computed_pnl.toFixed(2)} (${(driftPct * 100).toFixed(1)}% drift)`,
          agentId: row.id,
          detectedAt: new Date().toISOString(),
          corrected: false,
        };
        inconsistencies.push(inconsistency);
        totalInconsistencies++;

        console.warn(`[GSRE] ⚠ Inconsistency: ${inconsistency.description}`);
        eventBus.publish(MODULE, "gsre.inconsistency_detected",
          { inconsistency },
          { agentId: row.id, priority: "high" }
        );

        // Auto-correct: sync declared PnL to computed value
        if (inconsistency.severity === "high") {
          await query(
            `UPDATE agents SET performance = jsonb_set(COALESCE(performance,'{}'), '{pnl}', $1::text::jsonb), updated_at = NOW() WHERE id = $2`,
            [row.computed_pnl.toFixed(6), row.id]
          );
          inconsistency.corrected = true;
          totalCorrections++;
          eventBus.publish(MODULE, "gsre.correction_applied",
            { agentId: row.id, correctedPnl: row.computed_pnl },
            { priority: "normal" }
          );
        }
      }
    }

    totalReconciliations++;
    eventBus.publish(MODULE, "gsre.reconciled",
      { agentsChecked: result.rows.length, inconsistenciesFound: totalInconsistencies, correctionsApplied: totalCorrections },
      { priority: "low" }
    );
  } catch (err: any) {
    console.error(`[GSRE] Reconciliation error:`, err?.message);
  }
}

async function reconcileTradeIntegrity(): Promise<void> {
  try {
    // Find orphaned trades (no matching agent)
    const orphaned = await query(`
      SELECT t.id, t.agent_id FROM trades t
      LEFT JOIN agents a ON a.id = t.agent_id
      WHERE a.id IS NULL
      LIMIT 50
    `);

    for (const row of orphaned.rows) {
      const inc: Inconsistency = {
        type: "missing_trade",
        severity: "low",
        description: `Trade ${row.id} references non-existent agent ${row.agent_id}`,
        detectedAt: new Date().toISOString(),
        corrected: false,
      };
      inconsistencies.push(inc);
      totalInconsistencies++;
    }
  } catch {
    // Non-fatal — trades table may not exist yet
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getGSREStatus() {
  return {
    totalReconciliations,
    totalInconsistencies,
    totalCorrections,
    recentInconsistencies: inconsistencies.slice(-10),
  };
}

// ── Health ─────────────────────────────────────────────────────────────────────

const startTime = Date.now();
let errorCount = 0;

export function getGSREHealth(): ModuleHealth {
  return {
    name: MODULE,
    status: errorCount > 5 ? "degraded" : "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount,
    uptimeMs: Date.now() - startTime,
    metadata: { totalReconciliations, totalInconsistencies, totalCorrections },
  };
}

export function startGSRE(): void {
  if (!moduleConfig.ENABLE_GSRE) {
    console.log("[GSRE] Disabled via feature flag");
    return;
  }
  console.log("[GSRE] Global State Reconciliation Engine started — running every 5 min");

  const run = async () => {
    try {
      await reconcileAgentPnL();
      await reconcileTradeIntegrity();
    } catch (err: any) {
      errorCount++;
      console.error("[GSRE] Cycle error:", err?.message);
    }
  };

  setTimeout(run, 30_000);          // first run 30s after boot
  setInterval(run, 5 * 60_000);    // every 5 minutes
}
