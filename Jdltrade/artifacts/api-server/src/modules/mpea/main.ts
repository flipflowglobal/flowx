/**
 * MPEA — Multi-Path Execution Arbiter
 *
 * Simulates multiple execution routes before a trade:
 *  • Compares gas cost, slippage, latency per chain/DEX
 *  • Scores each route (lower = better composite cost)
 *  • Returns optimal route or aborts if none meet thresholds
 *
 * Publishes: execution.route_selected | execution.route_aborted
 * Input: TradeIntent + chain list
 * Output: ExecutionRoute
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { TradeIntent, ExecutionRoute, ModuleHealth } from "../shared/types.js";
import { getLIILLatency } from "../liil/main.js";

const MODULE = "MPEA";

// ── DEX catalogue ─────────────────────────────────────────────────────────────

interface DexProfile {
  name: string;
  chains: string[];
  baseSlippagePct: number;
  baseGasUsd: number;
  hasPrivateMempool: boolean;
}

const DEX_PROFILES: DexProfile[] = [
  { name: "uniswap-v3",  chains: ["ethereum", "polygon", "arbitrum", "optimism"], baseSlippagePct: 0.05, baseGasUsd: 8,  hasPrivateMempool: true  },
  { name: "sushiswap",   chains: ["ethereum", "polygon", "arbitrum", "bsc"],      baseSlippagePct: 0.10, baseGasUsd: 6,  hasPrivateMempool: false },
  { name: "pancakeswap", chains: ["bsc"],                                          baseSlippagePct: 0.12, baseGasUsd: 1,  hasPrivateMempool: false },
  { name: "trader-joe",  chains: ["avalanche"],                                    baseSlippagePct: 0.15, baseGasUsd: 0.5, hasPrivateMempool: false },
  { name: "camelot",     chains: ["arbitrum"],                                     baseSlippagePct: 0.08, baseGasUsd: 0.8, hasPrivateMempool: false },
  { name: "velodrome",   chains: ["optimism"],                                     baseSlippagePct: 0.07, baseGasUsd: 0.3, hasPrivateMempool: false },
];

// Gas multiplier by chain (relative to Ethereum mainnet = 1.0)
const CHAIN_GAS_MULTIPLIER: Record<string, number> = {
  ethereum:  1.0,
  polygon:   0.05,
  arbitrum:  0.08,
  optimism:  0.06,
  bsc:       0.03,
  avalanche: 0.04,
};

// ── Route scoring ──────────────────────────────────────────────────────────────

function scoreRoute(route: ExecutionRoute): number {
  // Composite cost score — lower = better
  const gasCost      = route.estimatedGasUsd / moduleConfig.MPEA_MAX_GAS_USD;
  const slippageCost = route.estimatedSlippagePct / moduleConfig.MPEA_MAX_SLIPPAGE_PCT;
  const latencyCost  = route.estimatedLatencyMs / 3000;
  const mevPenalty   = route.mevRisk === "high" ? 0.4 : route.mevRisk === "medium" ? 0.15 : 0;
  return gasCost * 0.35 + slippageCost * 0.40 + latencyCost * 0.15 + mevPenalty * 0.10;
}

function buildRoutes(intent: TradeIntent): ExecutionRoute[] {
  const routes: ExecutionRoute[] = [];
  const chains = intent.chain ? [intent.chain, "polygon", "arbitrum"] : ["ethereum", "polygon", "arbitrum"];

  for (const chain of chains) {
    const gasMultiplier = CHAIN_GAS_MULTIPLIER[chain] ?? 1.0;
    const liilLatency   = getLIILLatency(chain);

    const dexes = DEX_PROFILES.filter(d => d.chains.includes(chain));
    for (const dex of dexes) {
      // Slippage increases with trade size
      const sizeSlippage = Math.min(0.5, (intent.capitalUsd / 50_000) * 0.2);
      const slippage     = dex.baseSlippagePct + sizeSlippage + (Math.random() * 0.05);
      const gasUsd       = dex.baseGasUsd * gasMultiplier * (0.9 + Math.random() * 0.2);
      const latencyMs    = liilLatency + (Math.random() * 100);
      const mevRisk: ExecutionRoute["mevRisk"] =
        chain === "ethereum" && !dex.hasPrivateMempool ? "high"
        : chain === "ethereum" ? "medium"
        : "low";

      if (slippage > moduleConfig.MPEA_MAX_SLIPPAGE_PCT) continue;
      if (gasUsd > moduleConfig.MPEA_MAX_GAS_USD) continue;

      const route: ExecutionRoute = {
        routeId: `${chain}:${dex.name}`,
        chain,
        dex: dex.name,
        estimatedGasUsd: gasUsd,
        estimatedSlippagePct: slippage,
        estimatedLatencyMs: latencyMs,
        netCostScore: 0,  // filled below
        mevRisk,
        privateMempoolRequired: mevRisk === "high",
      };
      route.netCostScore = scoreRoute(route);
      routes.push(route);
    }
  }

  return routes.sort((a, b) => a.netCostScore - b.netCostScore);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function selectExecutionRoute(intent: TradeIntent): ExecutionRoute | null {
  if (!moduleConfig.ENABLE_MPEA) {
    // Pass-through when disabled — use a minimal default route
    return {
      routeId: `${intent.chain}:uniswap-v3`,
      chain: intent.chain,
      dex: "uniswap-v3",
      estimatedGasUsd: 10,
      estimatedSlippagePct: 0.1,
      estimatedLatencyMs: 400,
      netCostScore: 0.3,
      mevRisk: "medium",
      privateMempoolRequired: false,
    };
  }

  const routes = buildRoutes(intent);

  if (routes.length === 0) {
    eventBus.publish(MODULE, "execution.route_aborted",
      { intent, reason: "No route meets gas/slippage thresholds" },
      { agentId: intent.agentId, priority: "high" });
    return null;
  }

  const best = routes[0];
  eventBus.publish(MODULE, "execution.route_selected",
    { intent, route: best, routesConsidered: routes.length },
    { agentId: intent.agentId, priority: "normal" });

  return best;
}

// ── Health ────────────────────────────────────────────────────────────────────

const startTime = Date.now();
let totalRoutings = 0;

export function getMPEAHealth(): ModuleHealth {
  return {
    name: MODULE,
    status: "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: { totalRoutings, dexProfiles: DEX_PROFILES.length },
  };
}

export function startMPEA(): void {
  if (!moduleConfig.ENABLE_MPEA) {
    console.log("[MPEA] Disabled via feature flag");
    return;
  }
  console.log(`[MPEA] Multi-Path Execution Arbiter started — ${DEX_PROFILES.length} DEX profiles loaded`);
}
