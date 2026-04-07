/**
 * MRIL — Market Regime Intelligence Layer
 *
 * Classifies market regimes in real-time using:
 *  • EMA alignment (trend direction)
 *  • ATR normalised volatility (regime type)
 *  • Volume trend (OBV derivative)
 *  • ADX-like trend strength (directional movement)
 *
 * Publishes: regime.classified
 * Consumed by: CSFC, MASEE, MPEA, ARG
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { RegimeReport, RegimeState, ModuleHealth } from "../shared/types.js";
import { getPriceHistory, getTokenVolume } from "../../services/price-feed.js";
import { emaCalculate } from "../../services/trading-engine.js";

const MODULE = "MRIL";
const REFRESH_MS = 15_000;   // re-classify every 15s

// ── Internal state ─────────────────────────────────────────────────────────────

interface SymbolRegime {
  report: RegimeReport;
  updatedAt: number;
}

const regimeCache = new Map<string, SymbolRegime>();
const health: ModuleHealth = {
  name: MODULE,
  status: "running",
  lastHeartbeat: new Date().toISOString(),
  errorCount: 0,
  uptimeMs: 0,
};
const startTime = Date.now();

// ── Utility ───────────────────────────────────────────────────────────────────

function calcADX(prices: number[], period = 14): number {
  if (prices.length < period * 2) return 0.3;
  const dms: Array<{ plus: number; minus: number }> = [];
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    dms.push({ plus: Math.max(diff, 0), minus: Math.max(-diff, 0) });
  }
  const slice = dms.slice(-period);
  const plusAvg  = slice.reduce((s, d) => s + d.plus, 0)  / period;
  const minusAvg = slice.reduce((s, d) => s + d.minus, 0) / period;
  const total = plusAvg + minusAvg;
  if (total === 0) return 0;
  return Math.abs(plusAvg - minusAvg) / total;
}

function calcVolumeTrend(symbol: string): "increasing" | "decreasing" | "neutral" {
  const vol = getTokenVolume(symbol);
  if (vol > 5e9) return "increasing";
  if (vol < 1e9) return "decreasing";
  return "neutral";
}

function classifyRegime(symbol: string): RegimeReport {
  const prices = getPriceHistory(symbol);
  if (prices.length < 20) {
    return {
      regime: "ranging",
      clarity: 0.4,
      volatility: 0.02,
      trend_strength: 0.3,
      volume_trend: "neutral",
      timestamp: new Date().toISOString(),
    };
  }

  const recent20  = prices.slice(-20);
  const returns   = recent20.slice(1).map((p, i) => Math.abs((p - recent20[i]) / recent20[i]));
  const volatility = returns.reduce((a, b) => a + b, 0) / returns.length;
  const normVol    = Math.min(1, volatility / 0.05);  // normalise to 0-1 (5% = max)

  const ema20  = emaCalculate(prices, 20);
  const ema50  = prices.length >= 50 ? emaCalculate(prices, 50) : ema20;
  const ema100 = prices.length >= 100 ? emaCalculate(prices, 100) : ema50;
  const last   = prices[prices.length - 1];

  const trend_strength = calcADX(prices);
  const volume_trend   = calcVolumeTrend(symbol);

  let regime: RegimeState;
  let clarity: number;

  if (normVol > 0.7) {
    regime  = "volatile";
    clarity = 1 - normVol;  // lower clarity in extreme volatility
  } else if (ema20 > ema50 && ema50 > ema100 && last > ema20) {
    // All EMAs fanned up and price above fast EMA
    if (volume_trend === "increasing") {
      regime  = "accumulation";
      clarity = 0.75 + trend_strength * 0.2;
    } else {
      regime  = "trending_up";
      clarity = 0.65 + trend_strength * 0.25;
    }
  } else if (ema20 < ema50 && ema50 < ema100 && last < ema20) {
    // All EMAs fanned down
    if (volume_trend === "increasing") {
      regime  = "distribution";
      clarity = 0.70 + trend_strength * 0.2;
    } else {
      regime  = "trending_down";
      clarity = 0.65 + trend_strength * 0.25;
    }
  } else {
    regime  = "ranging";
    const distRatio = Math.abs(last - ema50) / (ema50 || 1);
    clarity = Math.max(0.3, 1 - distRatio * 15);
  }

  return {
    regime,
    clarity: Math.min(1, Math.max(0, clarity)),
    volatility: normVol,
    trend_strength: Math.min(1, trend_strength),
    volume_trend,
    timestamp: new Date().toISOString(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getRegime(symbol: string): RegimeReport {
  const cached = regimeCache.get(symbol);
  if (cached && Date.now() - cached.updatedAt < REFRESH_MS) return cached.report;

  const report = classifyRegime(symbol);
  regimeCache.set(symbol, { report, updatedAt: Date.now() });
  return report;
}

export function getMRILHealth(): ModuleHealth {
  health.lastHeartbeat = new Date().toISOString();
  health.uptimeMs = Date.now() - startTime;
  return { ...health };
}

// ── Background loop ───────────────────────────────────────────────────────────

const TRACKED_SYMBOLS = ["ETH", "BTC", "BNB", "MATIC", "AVAX", "ARB", "SOL", "LINK"];

function runClassification(): void {
  for (const symbol of TRACKED_SYMBOLS) {
    try {
      const report = classifyRegime(symbol);
      regimeCache.set(symbol, { report, updatedAt: Date.now() });

      eventBus.publish<{ symbol: string; report: RegimeReport }>(
        MODULE,
        "regime.classified",
        { symbol, report },
        { priority: "normal" }
      );
    } catch (err: any) {
      health.errorCount++;
      health.lastError = err?.message;
      health.status = "degraded";
    }
  }
  health.status = "running";
}

export function startMRIL(): void {
  if (!moduleConfig.ENABLE_MRIL) {
    console.log("[MRIL] Disabled via feature flag");
    health.status = "disabled";
    return;
  }
  console.log("[MRIL] Market Regime Intelligence Layer started — classifying every 15s");
  setTimeout(runClassification, 2_000);
  setInterval(runClassification, REFRESH_MS);
}
