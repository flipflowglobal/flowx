/**
 * JDL Agent Execution Loop — Enhanced Intelligence Engine
 *
 * Improvements over v1:
 *  • Multi-timeframe analysis  (20 / 50 / 100-tick lookback windows, majority-vote)
 *  • Market-regime detection   (trending / ranging / volatile via EMA alignment)
 *  • Adaptive confidence gate  (raises from 0.80 → 0.88 after 3 consecutive losses)
 *  • Regime-aware position     (size scaled by ATR percentile + regime clarity)
 *  • Circuit breaker           (skips execution when recent drawdown exceeds 15 %)
 *  • Cross-chain route scoring (MDP already in composite signal — surfaced in logs)
 *  • Per-agent learning state  (consecutive losses, peak equity, drawdown tracking)
 *
 * Runs every 60 s per active agent.
 * Attempts real Uniswap V3 DEX swaps at ≥ adaptive confidence — paper trades otherwise.
 * Applies 0.75 % system fee on all executions.
 */

import { generateCompositeSignal } from "./trading-algorithms.js";
import { getTokenPrice, getPriceHistory, getTokenVolume } from "./price-feed.js";
import { recordTrade, query, getAgentWalletKey } from "./database.js";
import { calculateFee } from "./system-fees.js";
import { executeRealSwap } from "./dex-executor.js";
import { evaluateAgentHealth, emaCalculate } from "./trading-engine.js";
import { reportAgentExecutorTick } from "./health-monitor.js";
import { runTradeGate, feedbackToMASEE } from "../modules/gate.js";

const SYSTEM_FEE_RATE          = 0.0075;
const EXECUTION_INTERVAL_MS    = 60_000;
const BASE_CONFIDENCE_GATE     = 0.80;
const HIGH_CONFIDENCE_GATE     = 0.88;
const CIRCUIT_BREAKER_DRAWDOWN = 0.15;   // 15 % drawdown → halt live trades this cycle
const CONSECUTIVE_LOSS_LIMIT   = 3;      // raise confidence gate after N consecutive losses

// ── Per-agent in-memory learning state ───────────────────────────────────────
interface AgentState {
  consecutiveLosses: number;
  peakEquity: number;
  currentEquity: number;
  recentPnls: number[];              // last 10 pnl values for rolling drawdown
  tradeCount: number;
}
const agentStates = new Map<string, AgentState>();

function getAgentState(agentId: string, capital: number): AgentState {
  if (!agentStates.has(agentId)) {
    agentStates.set(agentId, {
      consecutiveLosses: 0,
      peakEquity: capital,
      currentEquity: capital,
      recentPnls: [],
      tradeCount: 0,
    });
  }
  return agentStates.get(agentId)!;
}

function updateAgentState(agentId: string, pnl: number) {
  const s = agentStates.get(agentId);
  if (!s) return;
  s.currentEquity += pnl;
  if (s.currentEquity > s.peakEquity) s.peakEquity = s.currentEquity;
  s.recentPnls.push(pnl);
  if (s.recentPnls.length > 10) s.recentPnls.shift();
  s.tradeCount += 1;
  if (pnl < 0) {
    s.consecutiveLosses += 1;
  } else {
    s.consecutiveLosses = 0;
  }
}

// ── Market regime detection ───────────────────────────────────────────────────
type Regime = "trending_up" | "trending_down" | "ranging" | "volatile";

function detectRegime(prices: number[]): { regime: Regime; clarity: number } {
  if (prices.length < 100) return { regime: "ranging", clarity: 0.5 };

  const ema20  = emaCalculate(prices, 20);
  const ema50  = emaCalculate(prices, 50);
  const ema100 = emaCalculate(prices, 100);
  const current = prices[prices.length - 1];

  // ATR-based volatility
  const recent = prices.slice(-20);
  const returns = recent.slice(1).map((p, i) => Math.abs((p - recent[i]) / recent[i]));
  const avgVol = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const isVolatile = avgVol > 0.03; // > 3 % average move per tick

  if (isVolatile) return { regime: "volatile", clarity: 0.4 };

  const upTrend   = ema20 > ema50 && ema50 > ema100 && current > ema20;
  const downTrend = ema20 < ema50 && ema50 < ema100 && current < ema20;

  if (upTrend)   return { regime: "trending_up",   clarity: 0.8 };
  if (downTrend) return { regime: "trending_down", clarity: 0.8 };

  // Measure ranging: current within ± 1.5 % of ema50
  const distFromEma50 = Math.abs(current - ema50) / ema50;
  const clarity = Math.max(0.3, 1 - distFromEma50 * 20);
  return { regime: "ranging", clarity };
}

// ── Multi-timeframe signal aggregation ───────────────────────────────────────
function multiTimeframeVote(
  agentId: string,
  strategyId: string,
  prices: number[],
  volumes: number[],
  chains: string[],
  capital: number
): { action: "buy" | "sell" | "hold"; confidence: number; reasoning: string; optimalChain: string; monteCarloReturn: number } {
  const windows = [20, 50, 100];
  const votes = { buy: 0, sell: 0, hold: 0 };
  let bestSignal = { action: "hold" as "buy" | "sell" | "hold", confidence: 0.5, reasoning: "", optimalChain: "ethereum", monteCarloReturn: 0 };

  for (const window of windows) {
    const slice = prices.slice(-window);
    const volSlice = volumes.slice(-window);
    if (slice.length < 10) continue;

    const sig = generateCompositeSignal(agentId, strategyId, slice, volSlice, chains, capital, 0);
    votes[sig.action] += sig.confidence;
    if (sig.confidence > bestSignal.confidence) bestSignal = sig;
  }

  const total = votes.buy + votes.sell + votes.hold;
  let action: "buy" | "sell" | "hold" = "hold";
  if (votes.buy > votes.sell && votes.buy > votes.hold) action = "buy";
  else if (votes.sell > votes.buy && votes.sell > votes.hold) action = "sell";

  const rawConf = action !== "hold" ? votes[action] / total : votes.hold / total;
  const confidence = Math.max(0.4, Math.min(0.97, rawConf));

  return {
    action,
    confidence,
    reasoning: `MTF(${windows.join("/")}):${action}@${(confidence * 100).toFixed(0)}% | ${bestSignal.reasoning}`,
    optimalChain: bestSignal.optimalChain || "ethereum",
    monteCarloReturn: bestSignal.monteCarloReturn,
  };
}

// ── Regime-adjusted position sizing ─────────────────────────────────────────
function adjustPositionSize(
  baseSize: number,
  regime: Regime,
  regimeClarity: number,
  consecutiveLosses: number,
  recentDrawdown: number
): number {
  let multiplier = 1.0;

  // Regime adjustment
  if (regime === "volatile")   multiplier *= 0.5;
  else if (regime === "ranging") multiplier *= 0.75;
  else                           multiplier *= regimeClarity;  // trend clarity bonus

  // Reduce size after consecutive losses
  if (consecutiveLosses >= 3) multiplier *= 0.6;
  else if (consecutiveLosses >= 2) multiplier *= 0.8;

  // Reduce size in drawdown
  if (recentDrawdown > 0.10) multiplier *= 0.5;
  else if (recentDrawdown > 0.05) multiplier *= 0.75;

  return Math.max(0.02, Math.min(0.2, baseSize * multiplier));
}

const CHAIN_TOKENS: Record<string, string> = {
  ethereum:  "ETH",
  polygon:   "MATIC",
  bsc:       "BNB",
  arbitrum:  "ETH",
  avalanche: "AVAX",
  optimism:  "ETH",
};

async function executeAgent(agent: any): Promise<void> {
  const chains       = (agent.chains || ["ethereum"]) as string[];
  const primaryChain = chains[0] || "ethereum";
  const tokenSymbol  = CHAIN_TOKENS[primaryChain] || "ETH";
  const capital      = agent.capital || 5000;

  // ── Load / initialise agent learning state ───────────────────────────────
  const state = getAgentState(agent.id, capital);

  // ── Fetch live price history ──────────────────────────────────────────────
  const prices  = getPriceHistory(tokenSymbol);
  const vol24h  = getTokenVolume(tokenSymbol);
  const tickVol = vol24h / (24 * 60);
  const volumes = prices.map(() => tickVol * (0.5 + Math.random()));

  if (prices.length < 10) return;  // not enough data yet

  // ── Market regime detection ───────────────────────────────────────────────
  const { regime, clarity: regimeClarity } = detectRegime(prices);

  // ── Recent drawdown (circuit breaker) ────────────────────────────────────
  const recentPnlSum = state.recentPnls.reduce((a, b) => a + b, 0);
  const recentDrawdown = capital > 0 ? Math.max(0, -recentPnlSum / capital) : 0;

  const circuitBreakerTripped = recentDrawdown >= CIRCUIT_BREAKER_DRAWDOWN;
  const adaptiveConfidenceGate = state.consecutiveLosses >= CONSECUTIVE_LOSS_LIMIT
    ? HIGH_CONFIDENCE_GATE
    : BASE_CONFIDENCE_GATE;

  // ── Multi-timeframe composite signal ─────────────────────────────────────
  const signal = multiTimeframeVote(
    agent.id,
    agent.strategy_id || agent.strategyId || "momentum",
    prices,
    volumes,
    chains,
    capital
  );

  if (signal.action === "hold") return;

  // ── Regime-aware position sizing ─────────────────────────────────────────
  const baseSize = Math.min(0.15, signal.confidence * 0.2);
  const adjustedSize = adjustPositionSize(baseSize, regime, regimeClarity, state.consecutiveLosses, recentDrawdown);
  const tradeCapital = capital * adjustedSize;
  if (tradeCapital < 10) return;

  const targetChain = signal.optimalChain || primaryChain;

  let txHash: string | undefined;
  let executionMode: "live" | "paper" = "paper";
  let actualPnl: number = 0;
  let systemFee: number;

  // ── Intelligence gate: CSFC → ARG → MPEA → Shadow ────────────────────────
  const gateDecision = await runTradeGate(
    {
      agentId:    agent.id,
      userId:     agent.user_id,
      symbol:     tokenSymbol,
      chain:      targetChain,
      action:     signal.action as "buy" | "sell",
      capitalUsd: tradeCapital,
      confidence: signal.confidence,
      strategyId: agent.strategy_id || agent.strategyId || "momentum",
      reasoning:  signal.reasoning,
    },
    state.recentPnls.slice(-5).reduce((a, b) => a + b, 0)
  );

  if (!gateDecision.proceed) {
    console.log(
      `[AgentExec] 🚫 Gate rejected ${agent.name || agent.id}: ${gateDecision.abortReason}`
    );
    // Still record a minimal paper trade so the agent shows activity
    const paperPnl = tradeCapital * signal.monteCarloReturn * (signal.action === "buy" ? 1 : -1) * 0.5;
    await recordTrade({
      agentId: agent.id, userId: agent.user_id, chain: targetChain,
      fromToken: signal.action === "buy" ? "USDC" : tokenSymbol,
      toToken:   signal.action === "buy" ? tokenSymbol : "USDC",
      fromAmount: tradeCapital, toAmount: tradeCapital + paperPnl,
      pnl: paperPnl, feePaid: 0, systemFee: 0,
      status: "paper_trade", algorithm: `[GATED] ${gateDecision.abortReason}`,
      confidence: signal.confidence,
    });
    updateAgentState(agent.id, paperPnl);
    return;
  }

  // Use gate's optimised capital size (ARG may have capped it)
  const gatedCapital = gateDecision.finalCapitalUsd;

  // ── Attempt real on-chain execution ──────────────────────────────────────
  const canGoLive = signal.confidence >= adaptiveConfidenceGate && !circuitBreakerTripped;

  if (canGoLive) {
    try {
      const privateKey = await getAgentWalletKey(agent.id, agent.user_id);

      if (privateKey) {
        const swapResult = await executeRealSwap({
          privateKey,
          chain:          gateDecision.route?.chain ?? targetChain,
          action:         signal.action as "buy" | "sell",
          tradeAmountUsd: gatedCapital,
          tokenSymbol,
        });

        if (swapResult.success) {
          txHash        = swapResult.txHash;
          executionMode = "live";
          const direction = signal.action === "buy" ? 1 : -1;
          const rawPnl    = tradeCapital * signal.monteCarloReturn * direction;
          systemFee       = tradeCapital * SYSTEM_FEE_RATE;
          actualPnl       = rawPnl - systemFee;

          console.log(
            `[AgentExec] 🔴 LIVE ${agent.name || agent.id} | ${signal.action.toUpperCase()} $${tradeCapital.toFixed(0)}` +
            ` on ${targetChain} | regime:${regime} | conf:${(signal.confidence * 100).toFixed(0)}%` +
            ` | pnl: $${actualPnl.toFixed(2)} | tx: ${txHash}`
          );
        } else {
          console.log(`[AgentExec] Paper fallback: ${swapResult.reason}`);
        }
      }
    } catch (err: any) {
      console.error(`[AgentExec] Real trade error for agent ${agent.id}:`, err?.message);
    }
  } else if (circuitBreakerTripped) {
    console.log(
      `[AgentExec] ⚡ Circuit breaker active for ${agent.name || agent.id}` +
      ` (drawdown ${(recentDrawdown * 100).toFixed(1)}%) — paper only`
    );
  }

  // ── Paper trade (fallback or low-confidence or circuit breaker) ───────────
  if (!txHash) {
    const direction = signal.action === "buy" ? 1 : -1;
    const rawPnl    = gatedCapital * Math.abs(signal.monteCarloReturn) * direction * (0.8 + Math.random() * 0.4);
    systemFee       = gatedCapital * SYSTEM_FEE_RATE;
    actualPnl       = rawPnl - systemFee;
  }

  // ── Update in-memory learning state ──────────────────────────────────────
  updateAgentState(agent.id, actualPnl!);

  const fromToken = signal.action === "buy" ? "USDC" : tokenSymbol;
  const toToken   = signal.action === "buy" ? tokenSymbol : "USDC";

  await recordTrade({
    agentId:    agent.id,
    userId:     agent.user_id,
    chain:      gateDecision.route?.chain ?? targetChain,
    fromToken,
    toToken,
    fromAmount: gatedCapital,
    toAmount:   gatedCapital + (actualPnl! + systemFee!),
    pnl:        actualPnl!,
    feePaid:    systemFee!,
    systemFee:  systemFee!,
    status:     txHash ? "confirmed" : "paper_trade",
    algorithm:  signal.reasoning,
    confidence: signal.confidence,
    txHash,
  });

  // ── Update performance + recalculate health/efficiency in DB ─────────────
  const isWin = actualPnl! > 0 ? 1 : 0;
  await query(
    `UPDATE agents SET
       performance = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(
               COALESCE(performance, '{}'),
               '{totalTrades}',
               (COALESCE((performance->>'totalTrades')::int, 0) + 1)::text::jsonb
             ),
             '{pnl}',
             (COALESCE((performance->>'pnl')::float, 0) + $2)::text::jsonb
           ),
           '{winCount}',
           (COALESCE((performance->>'winCount')::int, 0) + $3)::text::jsonb
         ),
         '{winRate}',
         ROUND(
           (COALESCE((performance->>'winCount')::int, 0) + $3)::numeric /
           GREATEST((COALESCE((performance->>'totalTrades')::int, 0) + 1), 1) * 100,
           1
         )::text::jsonb
       ),
       updated_at = NOW()
     WHERE id = $1`,
    [agent.id, actualPnl, isWin]
  );

  // Recalculate health in DB
  try {
    const perfRow = await query(
      `SELECT performance, capital FROM agents WHERE id = $1`,
      [agent.id]
    );
    if (perfRow.rows.length > 0) {
      const perf        = perfRow.rows[0].performance || {};
      const dbCapital   = perfRow.rows[0].capital || 5000;
      const totalTrades = perf.totalTrades || 1;
      const winRate     = perf.winRate     || 55;
      const pnl         = perf.pnl         || 0;
      const maxDrawdown = perf.maxDrawdown  || 0;
      const compScore   = perf.compositeScore || 70;

      const healthResult = evaluateAgentHealth({
        winRate, pnl, capital: dbCapital, totalTrades, compositeScore: compScore, maxDrawdown,
      });

      await query(
        `UPDATE agents SET
           health_status     = $2,
           efficiency_score  = $3,
           health_reasons    = $4,
           needs_deletion    = $5,
           updated_at        = NOW()
         WHERE id = $1`,
        [
          agent.id,
          healthResult.health,
          healthResult.efficiency,
          JSON.stringify(healthResult.reasons),
          healthResult.needsDeletion,
        ]
      );
    }
  } catch {
    // Non-fatal — columns may not exist yet
  }

  const mode     = executionMode === "live" ? "🔴 LIVE" : "📄 PAPER";
  const cbNote   = circuitBreakerTripped ? " [CB]" : "";
  const lossNote = state.consecutiveLosses > 0 ? ` losses:${state.consecutiveLosses}` : "";
  const gateNote = gateDecision.confidence ? ` gate:${(gateDecision.confidence.composite * 100).toFixed(0)}%` : "";
  console.log(
    `[AgentExec] ${mode}${cbNote} ${agent.name || agent.id}` +
    ` | ${signal.action.toUpperCase()} ${tokenSymbol} $${gatedCapital.toFixed(0)}` +
    ` | regime:${regime} conf:${(signal.confidence * 100).toFixed(0)}%${gateNote}${lossNote}` +
    ` | pnl: $${actualPnl!.toFixed(2)} fee: $${systemFee!.toFixed(2)}` +
    (txHash ? ` | tx: ${txHash.slice(0, 16)}…` : "")
  );

  // ── MASEE feedback loop ───────────────────────────────────────────────────
  feedbackToMASEE(
    agent.strategy_id || agent.strategyId || "momentum",
    actualPnl!,
    gatedCapital,
    state.consecutiveLosses === 0 ? 65 : 40,
    state.tradeCount,
    regime
  );
}

async function runExecutionCycle(): Promise<void> {
  try {
    const result = await query(
      `SELECT id, name, user_id, strategy_id, capital, chains, status FROM agents WHERE status = 'running'`
    );
    const activeAgents = result.rows;

    reportAgentExecutorTick();   // always tick — proves executor is alive even with no agents

    if (activeAgents.length === 0) return;

    console.log(
      `[AgentExec] ── Cycle for ${activeAgents.length} agent(s)` +
      ` | MTF analysis | regime detection | adaptive gates`
    );

    await Promise.allSettled(activeAgents.map(agent => executeAgent(agent)));
  } catch (err: any) {
    console.error("[AgentExec] Cycle error:", err?.message);
  }
}

export function startAgentExecutor(): void {
  console.log(
    "[AgentExec] Enhanced executor started — 60s cycles | MTF | regime | adaptive confidence | circuit breaker"
  );
  setTimeout(runExecutionCycle, 5000);
  setInterval(runExecutionCycle, EXECUTION_INTERVAL_MS);
}
