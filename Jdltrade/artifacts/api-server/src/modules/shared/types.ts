/**
 * Shared Types — JDL Intelligence Module System
 * Defines the canonical event schema and all cross-module contracts.
 */

// ── Canonical Event Schema ────────────────────────────────────────────────────

export type EventPriority = "critical" | "high" | "normal" | "low";

export type EventType =
  // MRIL — regime classification
  | "regime.classified"
  // MASEE — strategy lifecycle
  | "strategy.ranked" | "strategy.mutated" | "strategy.retired"
  // MPEA — execution routing
  | "execution.route_selected" | "execution.route_aborted"
  // MEV — threat/opportunity
  | "mev.threat_detected" | "mev.opportunity_found" | "mev.route_privatised"
  // GSRE — reconciliation
  | "gsre.reconciled" | "gsre.inconsistency_detected" | "gsre.correction_applied"
  // PLI — liquidity prediction
  | "pli.liquidity_forecast" | "pli.cluster_shift_detected"
  // ARG — risk governance
  | "arg.risk_approved" | "arg.risk_denied" | "arg.kill_switch_activated" | "arg.kill_switch_lifted"
  // LIIL — infrastructure
  | "liil.rpc_switched" | "liil.latency_degraded" | "liil.latency_recovered"
  // Shadow — simulation
  | "shadow.simulation_complete" | "shadow.deviation_alert"
  // Kernel — system health
  | "kernel.module_restarted" | "kernel.module_failed" | "kernel.health_report"
  // CSFC — signal fusion
  | "csfc.confidence_scored"
  // AEE — alpha execution
  | "aee.opportunity_detected" | "aee.trade_submitted";

export interface JDLEvent<P = unknown> {
  id: string;
  timestamp: string;           // ISO-8601
  source: string;              // emitting module name
  type: EventType;
  payload: P;
  priority: EventPriority;
  correlationId?: string;      // links events in the same trade flow
  agentId?: string;
}

// ── Market Regime ─────────────────────────────────────────────────────────────

export type RegimeState =
  | "trending_up"
  | "trending_down"
  | "ranging"
  | "volatile"
  | "accumulation"
  | "distribution";

export interface RegimeReport {
  regime: RegimeState;
  clarity: number;             // 0–1
  volatility: number;          // normalised ATR
  trend_strength: number;      // ADX-like 0–1
  volume_trend: "increasing" | "decreasing" | "neutral";
  timestamp: string;
}

// ── Execution Route ───────────────────────────────────────────────────────────

export interface ExecutionRoute {
  routeId: string;
  chain: string;
  dex: string;
  estimatedGasUsd: number;
  estimatedSlippagePct: number;
  estimatedLatencyMs: number;
  netCostScore: number;        // lower = better (weighted composite)
  mevRisk: "low" | "medium" | "high";
  privateMempoolRequired: boolean;
}

// ── Risk Assessment ───────────────────────────────────────────────────────────

export interface RiskAssessment {
  approved: boolean;
  score: number;               // 0 (max risk) – 100 (safe)
  reasons: string[];
  killSwitchActive: boolean;
  positionSizeOverride?: number;  // if ARG adjusts size
}

// ── Confidence Score ──────────────────────────────────────────────────────────

export interface ConfidenceScore {
  composite: number;           // 0–1 final confidence
  components: Record<string, number>;
  weights: Record<string, number>;
  regime_bonus: number;
  risk_penalty: number;
  approved: boolean;           // passes minimum threshold
}

// ── Shadow Simulation ─────────────────────────────────────────────────────────

export interface SimulationResult {
  simulationId: string;
  expectedPnl: number;
  expectedSlippage: number;
  expectedGasUsd: number;
  successProbability: number;
  warnings: string[];
}

// ── Trade Intent ──────────────────────────────────────────────────────────────
// Passed through the CSFC → ARG → MPEA safety gate

export interface TradeIntent {
  agentId: string;
  userId: string;
  symbol: string;
  chain: string;
  action: "buy" | "sell";
  capitalUsd: number;
  confidence: number;
  strategyId: string;
  reasoning: string;
}

export interface GatedTradeDecision {
  proceed: boolean;
  abortReason?: string;
  confidence: ConfidenceScore;
  risk: RiskAssessment;
  route: ExecutionRoute | null;
  simulation: SimulationResult | null;
  finalCapitalUsd: number;     // may be adjusted by ARG
}

// ── Liquidity Forecast ────────────────────────────────────────────────────────

export interface LiquidityForecast {
  symbol: string;
  horizonMs: number;
  predictedDepthUsd: number;
  depthTrend: "improving" | "deteriorating" | "stable";
  confidence: number;
  walletClusterActivity: "accumulating" | "distributing" | "neutral";
}

// ── Module Health ─────────────────────────────────────────────────────────────

export type ModuleStatus = "running" | "degraded" | "failed" | "disabled";

export interface ModuleHealth {
  name: string;
  status: ModuleStatus;
  lastHeartbeat: string;
  errorCount: number;
  lastError?: string;
  uptimeMs: number;
  metadata?: Record<string, unknown>;
}
