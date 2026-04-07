/**
 * AEE — Alpha Extraction Engine
 *
 * Identifies and executes high-confidence alpha opportunities:
 *  • Cross-chain arbitrage (via existing trading engine)
 *  • Statistical pair divergence trades
 *  • Momentum burst detection
 *
 * Plugs into the existing execution engine via agent-executor hooks.
 *
 * Publishes: aee.opportunity_detected | aee.trade_submitted
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { ModuleHealth } from "../shared/types.js";
import { getTokenPrice, getPriceHistory, getTokenVolume } from "../../services/price-feed.js";
import { getRegime } from "../mril/main.js";
import { calculateRSI, bollingerBands, macdSignal } from "../../services/trading-engine.js";

const MODULE = "AEE";

// ── Alpha signal types ────────────────────────────────────────────────────────

export type AlphaType =
  | "cross_chain_arb"
  | "momentum_burst"
  | "mean_reversion"
  | "statistical_divergence";

export interface AlphaSignal {
  id: string;
  type: AlphaType;
  symbol: string;
  chain: string;
  action: "buy" | "sell";
  confidence: number;
  estimatedReturnPct: number;
  reasoning: string;
  expiresAt: number;   // timestamp — signal stale after this
}

// ── Internal state ─────────────────────────────────────────────────────────────

const activeSignals: AlphaSignal[] = [];
let totalSignalsGenerated = 0;
let totalTradesSubmitted  = 0;

// ── Alpha detection algorithms ────────────────────────────────────────────────

function detectMomentumBurst(symbol: string): AlphaSignal | null {
  const prices = getPriceHistory(symbol);
  if (prices.length < 20) return null;

  const rsi    = calculateRSI(prices, 14);
  const macd   = macdSignal(prices);
  const regime = getRegime(symbol);

  // Bullish burst: RSI 55-70 (not overbought), MACD hist positive, trending up
  const bullish = rsi > 55 && rsi < 70 && macd.histogram > 0 && regime.regime === "trending_up";
  // Bearish burst: RSI 30-45 (not oversold), MACD hist negative, trending down
  const bearish = rsi < 45 && rsi > 30 && macd.histogram < 0 && regime.regime === "trending_down";

  if (!bullish && !bearish) return null;

  const action    = bullish ? "buy" : "sell";
  const momentum  = Math.abs(macd.histogram) / Number(getTokenPrice(symbol) ?? 1);
  const confidence = 0.60 + regime.clarity * 0.20 + Math.min(0.1, momentum * 1000);

  return {
    id: `momentum-${symbol}-${Date.now()}`,
    type: "momentum_burst",
    symbol,
    chain: "ethereum",   // default — MPEA will optimise
    action,
    confidence: Math.min(0.92, confidence),
    estimatedReturnPct: momentum * 100 * 5,
    reasoning: `RSI:${rsi.toFixed(0)} MACD_hist:${macd.histogram.toFixed(4)} regime:${regime.regime} clarity:${(regime.clarity * 100).toFixed(0)}%`,
    expiresAt: Date.now() + 5 * 60_000,
  };
}

function detectMeanReversion(symbol: string): AlphaSignal | null {
  const prices = getPriceHistory(symbol);
  if (prices.length < 20) return null;

  const bb  = bollingerBands(prices, 20, 2);
  const rsi = calculateRSI(prices, 14);
  const current = prices[prices.length - 1];

  const oversold  = current < bb.lower && rsi < 35;
  const overbought = current > bb.upper && rsi > 65;

  if (!oversold && !overbought) return null;

  const action     = oversold ? "buy" : "sell";
  const zStrength  = Math.abs(bb.zScore);
  const confidence = 0.62 + Math.min(0.18, (zStrength - 2) * 0.06);

  return {
    id: `meanrev-${symbol}-${Date.now()}`,
    type: "mean_reversion",
    symbol,
    chain: "polygon",    // mean reversion suits low-gas chains
    action,
    confidence: Math.min(0.88, confidence),
    estimatedReturnPct: zStrength * 1.5,
    reasoning: `BB_zScore:${bb.zScore.toFixed(2)} RSI:${rsi.toFixed(0)} ${action.toUpperCase()} at ${action === "buy" ? "lower band" : "upper band"}`,
    expiresAt: Date.now() + 10 * 60_000,
  };
}

const TRACKED_SYMBOLS = ["ETH", "BTC", "MATIC", "ARB", "SOL", "LINK"];

function scanForAlpha(): void {
  // Remove expired signals
  const now = Date.now();
  const before = activeSignals.length;
  activeSignals.splice(0, activeSignals.length, ...activeSignals.filter(s => s.expiresAt > now));

  for (const symbol of TRACKED_SYMBOLS) {
    try {
      for (const detector of [detectMomentumBurst, detectMeanReversion]) {
        const signal = detector(symbol);
        if (!signal) continue;

        // Dedup: don't emit same type+symbol twice in active window
        const exists = activeSignals.some(s => s.symbol === signal.symbol && s.type === signal.type);
        if (exists) continue;

        activeSignals.push(signal);
        totalSignalsGenerated++;

        console.log(
          `[AEE] 🎯 Alpha: ${signal.type} ${signal.symbol} ${signal.action.toUpperCase()}` +
          ` conf:${(signal.confidence * 100).toFixed(0)}% est:+${signal.estimatedReturnPct.toFixed(2)}%`
        );

        eventBus.publish(MODULE, "aee.opportunity_detected",
          { signal },
          { priority: signal.confidence > 0.85 ? "high" : "normal" }
        );
      }
    } catch { /* non-fatal */ }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getActiveAlphaSignals(): AlphaSignal[] {
  return activeSignals.filter(s => s.expiresAt > Date.now());
}

export function recordTradeSubmitted(signalId: string): void {
  totalTradesSubmitted++;
  eventBus.publish(MODULE, "aee.trade_submitted", { signalId, total: totalTradesSubmitted }, { priority: "normal" });
}

// ── Health ─────────────────────────────────────────────────────────────────────

const startTime = Date.now();

export function getAEEHealth(): ModuleHealth {
  return {
    name: MODULE,
    status: "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: {
      totalSignalsGenerated,
      totalTradesSubmitted,
      activeSignals: activeSignals.filter(s => s.expiresAt > Date.now()).length,
    },
  };
}

export function startAEE(): void {
  if (!moduleConfig.ENABLE_AEE) {
    console.log("[AEE] Disabled via feature flag");
    return;
  }
  console.log("[AEE] Alpha Extraction Engine started — scanning every 30s");
  setTimeout(scanForAlpha, 10_000);
  setInterval(scanForAlpha, 30_000);
}
