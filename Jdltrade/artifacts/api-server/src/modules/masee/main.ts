/**
 * MASEE — Meta-Adaptive Strategy Evolution Engine
 *
 * Manages strategy lifecycle based on live performance metrics.
 * Uses a simple genetic algorithm approach: rank → select → mutate.
 * Strategies with persistent poor performance are retired.
 *
 * Publishes: strategy.ranked | strategy.mutated | strategy.retired
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { ModuleHealth } from "../shared/types.js";
import { getRegime } from "../mril/main.js";

const MODULE = "MASEE";

// ── Strategy performance record ───────────────────────────────────────────────

interface StrategyRecord {
  id: string;
  winRate: number;
  totalTrades: number;
  avgPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  regimeAccuracy: Record<string, number>;  // regime → win rate in that regime
  mutationGeneration: number;
  retiredAt?: string;
}

const strategyRecords = new Map<string, StrategyRecord>();

// ── Parameter mutation bounds ─────────────────────────────────────────────────

interface MutationDelta {
  param: string;
  delta: number;
  reason: string;
}

function computeMutations(record: StrategyRecord): MutationDelta[] {
  const mutations: MutationDelta[] = [];

  if (record.winRate < 50 && record.totalTrades > 20) {
    mutations.push({ param: "confidenceGate", delta: +0.05, reason: "Win rate below 50% — tighten confidence gate" });
  }
  if (record.maxDrawdown > 15) {
    mutations.push({ param: "positionSizeMultiplier", delta: -0.1, reason: "High drawdown — reduce position size" });
  }
  if (record.sharpeRatio < 0.5 && record.totalTrades > 10) {
    mutations.push({ param: "reentryDelay", delta: +5000, reason: "Poor Sharpe — increase re-entry delay" });
  }
  if (record.winRate > 75 && record.avgPnl > 0) {
    mutations.push({ param: "positionSizeMultiplier", delta: +0.05, reason: "High win rate — cautiously increase size" });
  }

  return mutations;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function ingestPerformance(strategyId: string, metrics: {
  winRate: number;
  totalTrades: number;
  avgPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  regime?: string;
}): void {
  const existing = strategyRecords.get(strategyId) ?? {
    id: strategyId,
    winRate: 50,
    totalTrades: 0,
    avgPnl: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    regimeAccuracy: {},
    mutationGeneration: 0,
  };

  // Exponential moving average update (α = 0.3)
  const α = 0.3;
  existing.winRate     = existing.totalTrades > 0 ? existing.winRate * (1 - α) + metrics.winRate * α : metrics.winRate;
  existing.avgPnl      = existing.totalTrades > 0 ? existing.avgPnl * (1 - α) + metrics.avgPnl * α    : metrics.avgPnl;
  existing.sharpeRatio = existing.totalTrades > 0 ? existing.sharpeRatio * (1 - α) + metrics.sharpeRatio * α : metrics.sharpeRatio;
  existing.maxDrawdown = Math.max(existing.maxDrawdown, metrics.maxDrawdown);
  existing.totalTrades += metrics.totalTrades;

  if (metrics.regime) {
    existing.regimeAccuracy[metrics.regime] = metrics.winRate;
  }

  strategyRecords.set(strategyId, existing);

  // Retire persistently failing strategies
  if (existing.totalTrades > 50 && existing.winRate < 35 && existing.avgPnl < 0) {
    existing.retiredAt = new Date().toISOString();
    console.warn(`[MASEE] Retiring strategy ${strategyId} — win:${existing.winRate.toFixed(0)}% avgPnl:${existing.avgPnl.toFixed(2)}`);
    eventBus.publish(MODULE, "strategy.retired", { strategyId, record: existing }, { priority: "high" });
    return;
  }

  // Apply mutations if needed
  const mutations = computeMutations(existing);
  if (mutations.length > 0) {
    existing.mutationGeneration++;
    console.log(`[MASEE] Mutating ${strategyId} gen${existing.mutationGeneration}: ${mutations.map(m => m.reason).join("; ")}`);
    eventBus.publish(MODULE, "strategy.mutated", { strategyId, mutations, generation: existing.mutationGeneration }, { priority: "normal" });
  }
}

export function getRankedStrategies(): StrategyRecord[] {
  const active = [...strategyRecords.values()].filter(s => !s.retiredAt);

  // Score = winRate*0.4 + sharpe*30*0.3 + (avgPnl/100)*0.2 + (1-drawdown/100)*0.1
  const scored = active.map(s => ({
    ...s,
    _score: s.winRate * 0.4 + Math.max(0, s.sharpeRatio) * 30 * 0.3 + Math.max(0, s.avgPnl / 100) * 0.2 + (1 - Math.min(s.maxDrawdown, 100) / 100) * 0.1,
  })).sort((a, b) => b._score - a._score);

  if (scored.length > 0) {
    eventBus.publish(MODULE, "strategy.ranked", { ranked: scored.map(s => s.id), count: scored.length }, { priority: "low" });
  }

  return scored;
}

export function getBestRegimeStrategy(regime: string): string | null {
  const active = [...strategyRecords.values()].filter(s => !s.retiredAt);
  const best = active
    .filter(s => s.regimeAccuracy[regime] !== undefined)
    .sort((a, b) => (b.regimeAccuracy[regime] ?? 0) - (a.regimeAccuracy[regime] ?? 0))[0];
  return best?.id ?? null;
}

// ── Health ─────────────────────────────────────────────────────────────────────

const startTime = Date.now();

export function getMASEEHealth(): ModuleHealth {
  const retired = [...strategyRecords.values()].filter(s => s.retiredAt).length;
  return {
    name: MODULE,
    status: "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: { trackedStrategies: strategyRecords.size, retiredStrategies: retired },
  };
}

// ── Periodic ranking ───────────────────────────────────────────────────────────

export function startMASEE(): void {
  if (!moduleConfig.ENABLE_MASEE) {
    console.log("[MASEE] Disabled via feature flag");
    return;
  }
  console.log("[MASEE] Meta-Adaptive Strategy Evolution Engine started");
  setInterval(() => {
    try { getRankedStrategies(); } catch { /* non-fatal */ }
  }, 60_000);
}
