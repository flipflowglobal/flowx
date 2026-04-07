/**
 * MEV — MEV Defense & Exploitation Engine
 *
 * Detects mempool-level threats (front-running, sandwich attacks).
 * Routes transactions through private channels when risk is high.
 * Identifies exploitable MEV opportunities for the system.
 *
 * Publishes: mev.threat_detected | mev.opportunity_found | mev.route_privatised
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { TradeIntent, ModuleHealth } from "../shared/types.js";

const MODULE = "MEV";

// ── Threat model ──────────────────────────────────────────────────────────────

interface MevThreat {
  type: "front_run" | "sandwich" | "back_run";
  severity: "low" | "medium" | "high";
  estimatedLossUsd: number;
  mitigationStrategy: "private_mempool" | "split_order" | "delay" | "none";
}

interface MevOpportunity {
  type: "cross_dex_arb" | "liquidation" | "sandwich";
  estimatedProfitUsd: number;
  confidence: number;
  chainId: string;
  executionWindowMs: number;
}

// ── Internal state ─────────────────────────────────────────────────────────────

interface MevState {
  recentThreats: MevThreat[];
  recentOpportunities: MevOpportunity[];
  totalThreatsDetected: number;
  totalPrivatisedRoutes: number;
}

const state: MevState = {
  recentThreats: [],
  recentOpportunities: [],
  totalThreatsDetected: 0,
  totalPrivatisedRoutes: 0,
};

// ── MEV threat detection ───────────────────────────────────────────────────────

export function assessMevRisk(intent: TradeIntent): {
  threatsDetected: MevThreat[];
  requiresPrivateRoute: boolean;
  recommendedGasMultiplier: number;
} {
  const threats: MevThreat[] = [];

  // Large trades on mainnet are highly visible to MEV bots
  const isMainnet     = intent.chain === "ethereum";
  const isLargeTrade  = intent.capitalUsd > 10_000;
  const isArbitrage   = intent.strategyId.includes("arb");

  if (isMainnet && isLargeTrade) {
    const threat: MevThreat = {
      type: "sandwich",
      severity: intent.capitalUsd > 50_000 ? "high" : "medium",
      estimatedLossUsd: intent.capitalUsd * 0.003,
      mitigationStrategy: "private_mempool",
    };
    threats.push(threat);
    state.totalThreatsDetected++;

    eventBus.publish(MODULE, "mev.threat_detected",
      { intent, threat },
      { agentId: intent.agentId, priority: "high" }
    );
  }

  if (isArbitrage && intent.capitalUsd > 5_000) {
    const threat: MevThreat = {
      type: "front_run",
      severity: "medium",
      estimatedLossUsd: intent.capitalUsd * 0.001,
      mitigationStrategy: "split_order",
    };
    threats.push(threat);
    state.totalThreatsDetected++;
  }

  const requiresPrivateRoute = threats.some(t => t.mitigationStrategy === "private_mempool");
  if (requiresPrivateRoute) {
    state.totalPrivatisedRoutes++;
    eventBus.publish(MODULE, "mev.route_privatised",
      { intent, threats },
      { agentId: intent.agentId, priority: "high" }
    );
  }

  state.recentThreats = [...threats, ...state.recentThreats].slice(0, 50);

  // Gas multiplier: bid above bots to reduce front-run probability
  const gasMultiplier = threats.some(t => t.severity === "high") ? 1.3
    : threats.some(t => t.severity === "medium") ? 1.15
    : 1.0;

  return { threatsDetected: threats, requiresPrivateRoute, recommendedGasMultiplier: gasMultiplier };
}

// ── Opportunity scanner ───────────────────────────────────────────────────────

function scanOpportunities(): void {
  // Simulate real-world MEV opportunity detection
  // In production this connects to mempool stream / Flashbots bundle relay
  const rand = Math.random();

  if (rand > 0.92) {
    // ~8% chance each scan: cross-DEX arb window
    const opp: MevOpportunity = {
      type: "cross_dex_arb",
      estimatedProfitUsd: 50 + Math.random() * 500,
      confidence: 0.75 + Math.random() * 0.2,
      chainId: ["ethereum", "arbitrum", "polygon"][Math.floor(Math.random() * 3)],
      executionWindowMs: 500 + Math.random() * 1000,
    };
    state.recentOpportunities = [opp, ...state.recentOpportunities].slice(0, 20);
    eventBus.publish(MODULE, "mev.opportunity_found", { opportunity: opp }, { priority: "high" });
    console.log(`[MEV] 🎯 Opportunity: ${opp.type} on ${opp.chainId} — est. $${opp.estimatedProfitUsd.toFixed(0)} profit`);
  }
}

export function getMevStats() {
  return {
    totalThreatsDetected: state.totalThreatsDetected,
    totalPrivatisedRoutes: state.totalPrivatisedRoutes,
    recentThreats: state.recentThreats.slice(0, 5),
    recentOpportunities: state.recentOpportunities.slice(0, 5),
  };
}

// ── Health ─────────────────────────────────────────────────────────────────────

const startTime = Date.now();

export function getMEVHealth(): ModuleHealth {
  return {
    name: MODULE,
    status: "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: {
      threatsDetected:   state.totalThreatsDetected,
      privatisedRoutes:  state.totalPrivatisedRoutes,
      opportunitiesLive: state.recentOpportunities.length,
    },
  };
}

export function startMEV(): void {
  if (!moduleConfig.ENABLE_MEV) {
    console.log("[MEV] Disabled via feature flag");
    return;
  }
  console.log("[MEV] MEV Defense & Exploitation Engine started — scanning every 10s");
  setInterval(scanOpportunities, 10_000);
}
