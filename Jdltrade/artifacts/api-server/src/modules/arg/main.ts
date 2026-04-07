/**
 * ARG — Autonomous Risk Governor
 *
 * Enforces global risk rules on every trade intent.
 * Implements a kill switch (manual or automatic).
 * All trades MUST pass ARG before execution.
 *
 * Publishes: arg.risk_approved | arg.risk_denied | arg.kill_switch_activated
 * Input: TradeIntent
 * Output: RiskAssessment
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { TradeIntent, RiskAssessment, ModuleHealth } from "../shared/types.js";
import { getRegime } from "../mril/main.js";

const MODULE = "ARG";

// ── Kill switch state ──────────────────────────────────────────────────────────

let killSwitchActive = false;
let killSwitchReason = "";

// ── Per-agent daily loss tracking ─────────────────────────────────────────────

interface AgentRiskState {
  dailyLossUsd: number;
  dailyResetAt: number;   // timestamp of next midnight reset
  consecutiveDenials: number;
  totalTradesApproved: number;
}
const agentRisk = new Map<string, AgentRiskState>();

function getAgentRisk(agentId: string): AgentRiskState {
  if (!agentRisk.has(agentId)) {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    agentRisk.set(agentId, {
      dailyLossUsd: 0,
      dailyResetAt: tomorrow.getTime(),
      consecutiveDenials: 0,
      totalTradesApproved: 0,
    });
  }
  return agentRisk.get(agentId)!;
}

function maybeResetDaily(state: AgentRiskState): void {
  if (Date.now() >= state.dailyResetAt) {
    state.dailyLossUsd = 0;
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    state.dailyResetAt = tomorrow.getTime();
  }
}

// ── Risk evaluation ───────────────────────────────────────────────────────────

export function evaluateRisk(intent: TradeIntent, recentPnlUsd = 0): RiskAssessment {
  const reasons: string[] = [];
  let score = 100;

  if (killSwitchActive) {
    return {
      approved: false,
      score: 0,
      reasons: [`Kill switch active: ${killSwitchReason}`],
      killSwitchActive: true,
    };
  }

  const state = getAgentRisk(intent.agentId);
  maybeResetDaily(state);

  // 1. Position size limit
  if (intent.capitalUsd > moduleConfig.ARG_MAX_POSITION_USD) {
    reasons.push(`Position $${intent.capitalUsd.toFixed(0)} exceeds max $${moduleConfig.ARG_MAX_POSITION_USD}`);
    score -= 40;
  }

  // 2. Daily loss limit
  const projectedDailyLoss = state.dailyLossUsd + Math.max(0, -recentPnlUsd);
  if (projectedDailyLoss > moduleConfig.ARG_MAX_DAILY_LOSS_USD) {
    reasons.push(`Daily loss $${projectedDailyLoss.toFixed(0)} would exceed limit $${moduleConfig.ARG_MAX_DAILY_LOSS_USD}`);
    score -= 50;
  }

  // 3. Minimum confidence
  if (intent.confidence < moduleConfig.ARG_MIN_CONFIDENCE) {
    reasons.push(`Confidence ${(intent.confidence * 100).toFixed(0)}% below minimum ${(moduleConfig.ARG_MIN_CONFIDENCE * 100).toFixed(0)}%`);
    score -= 25;
  }

  // 4. Regime risk — volatile regime increases required confidence
  const regime = getRegime(intent.symbol.replace(/USD.*/, ""));
  if (regime.regime === "volatile" && intent.confidence < 0.85) {
    reasons.push("Volatile regime: confidence must be ≥ 85%");
    score -= 20;
  }

  // 5. Consecutive denials circuit breaker
  if (state.consecutiveDenials >= 5) {
    reasons.push("Circuit breaker: 5+ consecutive denials — cooling off");
    score -= 35;
  }

  // 6. Auto kill switch: very high drawdown
  const drawdownPct = projectedDailyLoss / Math.max(intent.capitalUsd, 1) * 100;
  if (drawdownPct > moduleConfig.ARG_MAX_DRAWDOWN_PCT * 2) {
    activateKillSwitch(`Drawdown ${drawdownPct.toFixed(1)}% far exceeds limit — automatic kill switch`);
    return {
      approved: false,
      score: 0,
      reasons: ["Kill switch auto-activated due to extreme drawdown"],
      killSwitchActive: true,
    };
  }

  const approved = score >= 50 && reasons.length === 0;

  // Cap position size at ARG maximum regardless
  const positionSizeOverride = intent.capitalUsd > moduleConfig.ARG_MAX_POSITION_USD
    ? moduleConfig.ARG_MAX_POSITION_USD
    : undefined;

  if (approved) {
    state.consecutiveDenials = 0;
    state.totalTradesApproved++;
    eventBus.publish(MODULE, "arg.risk_approved", { intent, score }, { agentId: intent.agentId, priority: "normal" });
  } else {
    state.consecutiveDenials++;
    eventBus.publish(MODULE, "arg.risk_denied", { intent, score, reasons }, { agentId: intent.agentId, priority: "high" });
  }

  return { approved, score: Math.max(0, score), reasons, killSwitchActive: false, positionSizeOverride };
}

// ── Kill switch ───────────────────────────────────────────────────────────────

export function activateKillSwitch(reason: string): void {
  killSwitchActive = true;
  killSwitchReason = reason;
  console.error(`[ARG] ⚡ KILL SWITCH ACTIVATED — ${reason}`);
  eventBus.publish(MODULE, "arg.kill_switch_activated", { reason }, { priority: "critical" });
}

export function liftKillSwitch(): void {
  killSwitchActive = false;
  killSwitchReason = "";
  console.log("[ARG] Kill switch lifted");
  eventBus.publish(MODULE, "arg.kill_switch_lifted", {}, { priority: "high" });
}

export function isKillSwitchActive(): boolean { return killSwitchActive; }

export function reportLoss(agentId: string, lossUsd: number): void {
  const state = getAgentRisk(agentId);
  if (lossUsd > 0) state.dailyLossUsd += lossUsd;
}

// ── Health ────────────────────────────────────────────────────────────────────

const startTime = Date.now();

export function getARGHealth(): ModuleHealth {
  return {
    name: MODULE,
    status: killSwitchActive ? "degraded" : "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: {
      killSwitchActive,
      trackedAgents: agentRisk.size,
    },
  };
}

export function startARG(): void {
  if (!moduleConfig.ENABLE_ARG) {
    console.log("[ARG] Disabled via feature flag");
    return;
  }
  console.log("[ARG] Autonomous Risk Governor started — kill switch armed, limits enforced");
}
