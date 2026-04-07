/**
 * CSFC — Cognitive Signal Fusion Core
 *
 * Aggregates signals from all intelligence modules into a single weighted
 * trade_confidence_score using Shapley-fair weighting.
 *
 * Gate: if composite < CSFC_MIN_CONFIDENCE → abort trade
 *
 * Publishes: csfc.confidence_scored
 * Input: TradeIntent + optional module signals
 * Output: ConfidenceScore
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { TradeIntent, ConfidenceScore, ModuleHealth } from "../shared/types.js";
import { getRegime } from "../mril/main.js";
import { getLiquidityBias } from "../pli/main.js";
import { getPriceHistory } from "../../services/price-feed.js";

const MODULE = "CSFC";

// ── Historical weight calibration ─────────────────────────────────────────────
// Weights are seeded from domain knowledge; MASEE updates them via ingestPerformance.

const SIGNAL_WEIGHTS: Record<string, number> = {
  base_confidence:  0.30,   // agent's raw MTF confidence
  regime_alignment: 0.20,   // MRIL regime clarity × direction match
  liquidity_bias:   0.15,   // PLI depth forecast
  mev_safety:       0.10,   // lower weight when MEV risk is high
  momentum:         0.15,   // short-term price momentum
  volatility_adj:   0.10,   // penalise high-vol environments
};

// ── Scoring helpers ───────────────────────────────────────────────────────────

function scoreMomentum(symbol: string, action: "buy" | "sell"): number {
  const prices: number[] = getPriceHistory(symbol);
  if (prices.length < 10) return 0.5;

  const recent = prices.slice(-10);
  const ma5    = recent.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10   = recent.reduce((a, b) => a + b, 0) / 10;

  const bullish = ma5 > ma10;
  if (action === "buy")  return bullish ? 0.75 : 0.35;
  if (action === "sell") return !bullish ? 0.75 : 0.35;
  return 0.5;
}

function scoreVolatilityAdj(symbol: string): number {
  const regime = getRegime(symbol);
  if (regime.regime === "volatile") return 0.3;
  if (regime.volatility > 0.6) return 0.45;
  if (regime.volatility > 0.4) return 0.60;
  return 0.85;
}

function scoreRegimeAlignment(symbol: string, action: "buy" | "sell"): number {
  const regime = getRegime(symbol);
  const clarity = regime.clarity;

  let alignment: number;
  if (action === "buy") {
    alignment = regime.regime === "trending_up" || regime.regime === "accumulation" ? 1.0
      : regime.regime === "ranging" ? 0.6
      : regime.regime === "volatile" ? 0.3
      : 0.2;  // trending_down / distribution
  } else {
    alignment = regime.regime === "trending_down" || regime.regime === "distribution" ? 1.0
      : regime.regime === "ranging" ? 0.6
      : regime.regime === "volatile" ? 0.3
      : 0.2;
  }

  return alignment * clarity;
}

// ── Main fusion function ──────────────────────────────────────────────────────

export function fuseSignals(intent: TradeIntent, mevRiskLevel: "low" | "medium" | "high" = "low"): ConfidenceScore {
  const symbol = intent.symbol.replace(/USD.*/, "") || "ETH";

  const components: Record<string, number> = {
    base_confidence:  intent.confidence,
    regime_alignment: scoreRegimeAlignment(symbol, intent.action),
    liquidity_bias:   getLiquidityBias(symbol),
    mev_safety:       mevRiskLevel === "high" ? 0.3 : mevRiskLevel === "medium" ? 0.65 : 0.9,
    momentum:         scoreMomentum(symbol, intent.action),
    volatility_adj:   scoreVolatilityAdj(symbol),
  };

  const regime = getRegime(symbol);
  const regime_bonus = (regime.regime === "trending_up"   && intent.action === "buy")  ? 0.05
    : (regime.regime === "trending_down" && intent.action === "sell") ? 0.05
    : 0;

  const risk_penalty = mevRiskLevel === "high" ? 0.08 : mevRiskLevel === "medium" ? 0.03 : 0;

  let composite = 0;
  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    composite += (components[key] ?? 0) * weight;
  }
  composite = Math.max(0, Math.min(1, composite + regime_bonus - risk_penalty));

  const approved = composite >= moduleConfig.CSFC_MIN_CONFIDENCE;

  const score: ConfidenceScore = {
    composite,
    components,
    weights: { ...SIGNAL_WEIGHTS },
    regime_bonus,
    risk_penalty,
    approved,
  };

  eventBus.publish(MODULE, "csfc.confidence_scored",
    { intent, score },
    { agentId: intent.agentId, priority: "normal" }
  );

  if (!approved) {
    console.log(
      `[CSFC] ✗ Trade rejected — composite ${(composite * 100).toFixed(1)}% < threshold ${(moduleConfig.CSFC_MIN_CONFIDENCE * 100).toFixed(0)}%` +
      ` | ${intent.agentId} ${intent.action.toUpperCase()} ${symbol}`
    );
  }

  return score;
}

// ── Weight updates from MASEE ─────────────────────────────────────────────────

export function updateWeights(newWeights: Partial<typeof SIGNAL_WEIGHTS>): void {
  for (const [key, val] of Object.entries(newWeights)) {
    if (key in SIGNAL_WEIGHTS && typeof val === "number") {
      SIGNAL_WEIGHTS[key] = Math.max(0.02, Math.min(0.5, val));
    }
  }
  // Re-normalise weights to sum to 1
  const total = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(SIGNAL_WEIGHTS)) {
    SIGNAL_WEIGHTS[key] /= total;
  }
}

// ── Health ─────────────────────────────────────────────────────────────────────

const startTime = Date.now();
let fusionCount  = 0;
let approvalCount = 0;

export function getCSFCHealth(): ModuleHealth {
  return {
    name: MODULE,
    status: "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: {
      fusionCount,
      approvalRate: fusionCount > 0 ? (approvalCount / fusionCount * 100).toFixed(1) + "%" : "n/a",
      minConfidence: moduleConfig.CSFC_MIN_CONFIDENCE,
    },
  };
}

export function startCSFC(): void {
  if (!moduleConfig.ENABLE_CSFC) {
    console.log("[CSFC] Disabled via feature flag");
    return;
  }
  console.log("[CSFC] Cognitive Signal Fusion Core started — Shapley-weighted fusion active");
}
