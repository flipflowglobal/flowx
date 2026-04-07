/**
 * Intelligence Gate — CSFC → ARG → MPEA → Shadow
 *
 * This is the single entry point for the agent-executor to pass a trade
 * through all intelligence modules before execution.
 *
 * Gate contract:
 *   1. CSFC: fuse all signals → composite confidence score
 *   2. ARG:  evaluate risk → approve/deny + optional size cap
 *   3. MPEA: find optimal execution route
 *   4. Shadow: run Monte Carlo simulation
 *   5. MEV:  assess threat level
 *
 * Returns GatedTradeDecision — if .proceed is false, abort execution.
 */

import type { TradeIntent, GatedTradeDecision } from "./shared/types.js";
import { fuseSignals } from "./csfc/main.js";
import { evaluateRisk } from "./arg/main.js";
import { selectExecutionRoute } from "./mpea/main.js";
import { simulate } from "./shadow/main.js";
import { assessMevRisk } from "./mev/main.js";
import { moduleConfig } from "./shared/config.js";
import { ingestPerformance } from "./masee/main.js";

export async function runTradeGate(
  intent: TradeIntent,
  recentPnlUsd = 0
): Promise<GatedTradeDecision> {
  // ── Step 1: MEV risk assessment (needed by CSFC) ──────────────────────────
  const mev = assessMevRisk(intent);
  const mevRiskLevel = mev.threatsDetected.some(t => t.severity === "high") ? "high"
    : mev.threatsDetected.some(t => t.severity === "medium") ? "medium"
    : "low";

  // ── Step 2: CSFC — signal fusion ──────────────────────────────────────────
  const confidence = fuseSignals(intent, mevRiskLevel);

  if (!confidence.approved) {
    return {
      proceed: false,
      abortReason: `CSFC: composite confidence ${(confidence.composite * 100).toFixed(1)}% below threshold ${(moduleConfig.CSFC_MIN_CONFIDENCE * 100).toFixed(0)}%`,
      confidence,
      risk: { approved: false, score: 0, reasons: ["CSFC gate failed"], killSwitchActive: false },
      route: null,
      simulation: null,
      finalCapitalUsd: intent.capitalUsd,
    };
  }

  // ── Step 3: ARG — risk governance ─────────────────────────────────────────
  const risk = evaluateRisk({ ...intent, confidence: confidence.composite }, recentPnlUsd);

  if (!risk.approved) {
    return {
      proceed: false,
      abortReason: `ARG: ${risk.reasons.join("; ")}`,
      confidence,
      risk,
      route: null,
      simulation: null,
      finalCapitalUsd: intent.capitalUsd,
    };
  }

  // Apply ARG position size override
  const finalCapitalUsd = risk.positionSizeOverride
    ? Math.min(intent.capitalUsd, risk.positionSizeOverride)
    : intent.capitalUsd;

  // ── Step 4: MPEA — execution routing ──────────────────────────────────────
  const route = selectExecutionRoute({ ...intent, capitalUsd: finalCapitalUsd });

  if (!route) {
    return {
      proceed: false,
      abortReason: "MPEA: no valid execution route meets gas/slippage thresholds",
      confidence,
      risk,
      route: null,
      simulation: null,
      finalCapitalUsd,
    };
  }

  // ── Step 5: Shadow simulation ──────────────────────────────────────────────
  const simulation = simulate({ ...intent, capitalUsd: finalCapitalUsd, chain: route.chain });

  // Fail on very low success probability even if other gates pass
  if (simulation.successProbability < 0.40) {
    return {
      proceed: false,
      abortReason: `Shadow: success probability ${(simulation.successProbability * 100).toFixed(0)}% too low`,
      confidence,
      risk,
      route,
      simulation,
      finalCapitalUsd,
    };
  }

  return {
    proceed: true,
    confidence,
    risk,
    route,
    simulation,
    finalCapitalUsd,
  };
}

// ── MASEE feedback loop ───────────────────────────────────────────────────────
// Call this after a trade completes to feed performance back to MASEE

export function feedbackToMASEE(
  strategyId: string,
  pnl: number,
  capitalUsd: number,
  winRate: number,
  totalTrades: number,
  regime?: string
): void {
  try {
    ingestPerformance(strategyId, {
      winRate,
      totalTrades,
      avgPnl: pnl,
      sharpeRatio: pnl > 0 ? 1.2 : -0.5,
      maxDrawdown: pnl < 0 ? Math.abs(pnl) / capitalUsd * 100 : 0,
      regime,
    });
  } catch { /* non-fatal */ }
}
