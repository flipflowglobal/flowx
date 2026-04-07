/**
 * Shadow Simulation Engine
 *
 * Runs a Monte Carlo simulation of each trade intent before live execution.
 * Compares simulated vs actual outcomes post-trade to calibrate models.
 * Raises a deviation alert if real outcome diverges significantly.
 *
 * Publishes: shadow.simulation_complete | shadow.deviation_alert
 * Input: TradeIntent
 * Output: SimulationResult
 */

import { randomUUID } from "crypto";
import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { TradeIntent, SimulationResult, ModuleHealth } from "../shared/types.js";
import { getPriceHistory } from "../../services/price-feed.js";

const MODULE = "Shadow";

const ITERATIONS = 500;   // Monte Carlo iterations

// ── Simulation record ─────────────────────────────────────────────────────────

interface SimRecord {
  simulation: SimulationResult;
  intent: TradeIntent;
  actualPnl?: number;
  completedAt?: string;
}

const simHistory = new Map<string, SimRecord>();

// ── Monte Carlo simulation ────────────────────────────────────────────────────

function computeHistoricalVol(symbol: string): number {
  const prices = getPriceHistory(symbol);
  if (prices.length < 10) return 0.02;
  const returns = prices.slice(-20).slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

export function simulate(intent: TradeIntent): SimulationResult {
  const symbol     = intent.symbol.replace(/USD.*/, "") || "ETH";
  const vol        = computeHistoricalVol(symbol);
  const direction  = intent.action === "buy" ? 1 : -1;

  let wins = 0;
  let totalReturn = 0;
  let totalSlippage = 0;
  const warnings: string[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    // Box-Muller normal sample
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random() || 1e-10;
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    const ret       = direction * (intent.confidence - 0.5) * 0.04 + z * vol;
    const slippage  = Math.abs(z) * 0.002 + 0.001;  // min 0.1% slippage

    totalReturn  += ret;
    totalSlippage += slippage;
    if (ret > 0) wins++;
  }

  const avgReturn   = totalReturn / ITERATIONS;
  const avgSlippage = totalSlippage / ITERATIONS;
  const successProb = wins / ITERATIONS;
  const expectedPnl = intent.capitalUsd * avgReturn;
  const gasUsd      = 5 + Math.random() * 15;

  if (successProb < 0.45) warnings.push("Win probability below 45% — high risk");
  if (avgSlippage > 0.005) warnings.push(`Expected slippage ${(avgSlippage * 100).toFixed(2)}% — consider smaller size`);
  if (vol > 0.04) warnings.push("High historical volatility — widen stop loss");

  const result: SimulationResult = {
    simulationId: randomUUID(),
    expectedPnl,
    expectedSlippage: avgSlippage * 100,
    expectedGasUsd:   gasUsd,
    successProbability: successProb,
    warnings,
  };

  const record: SimRecord = { simulation: result, intent };
  simHistory.set(result.simulationId, record);

  eventBus.publish(MODULE, "shadow.simulation_complete",
    { intent, result },
    { agentId: intent.agentId, priority: "normal" }
  );

  return result;
}

// ── Post-trade deviation check ────────────────────────────────────────────────

export function recordActualOutcome(simulationId: string, actualPnlUsd: number): void {
  const record = simHistory.get(simulationId);
  if (!record) return;

  record.actualPnl   = actualPnlUsd;
  record.completedAt = new Date().toISOString();

  const expected  = record.simulation.expectedPnl;
  const deviation = expected !== 0 ? Math.abs(actualPnlUsd - expected) / Math.abs(expected) : 0;

  if (deviation > moduleConfig.SHADOW_DEVIATION_THRESHOLD) {
    console.warn(
      `[Shadow] ⚠ Deviation alert: expected $${expected.toFixed(2)} actual $${actualPnlUsd.toFixed(2)}` +
      ` (${(deviation * 100).toFixed(1)}% off)`
    );
    eventBus.publish(MODULE, "shadow.deviation_alert",
      { simulationId, expectedPnl: expected, actualPnl: actualPnlUsd, deviationPct: deviation * 100 },
      { agentId: record.intent.agentId, priority: "high" }
    );
  }
}

export function getSimulation(simulationId: string): SimRecord | undefined {
  return simHistory.get(simulationId);
}

// ── Health ─────────────────────────────────────────────────────────────────────

const startTime = Date.now();

export function getShadowHealth(): ModuleHealth {
  const completed = [...simHistory.values()].filter(r => r.completedAt).length;
  return {
    name: MODULE,
    status: "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: {
      totalSimulations:   simHistory.size,
      completedTrades:    completed,
      monteCarloIterations: ITERATIONS,
    },
  };
}

export function startShadow(): void {
  if (!moduleConfig.ENABLE_SHADOW) {
    console.log("[Shadow] Disabled via feature flag");
    return;
  }
  console.log(`[Shadow] Shadow Simulation Engine started — ${ITERATIONS} Monte Carlo iterations per trade`);
}
