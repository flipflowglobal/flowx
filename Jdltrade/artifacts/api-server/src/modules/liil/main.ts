/**
 * LIIL — Latency & Infrastructure Intelligence Layer
 *
 * Monitors RPC endpoint health and latency.
 * Dynamically switches to faster/healthier endpoints.
 * Provides per-chain latency metrics to MPEA.
 *
 * Publishes: liil.rpc_switched | liil.latency_degraded | liil.latency_recovered
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { ModuleHealth } from "../shared/types.js";

const MODULE = "LIIL";

// ── RPC endpoint registry ──────────────────────────────────────────────────────

interface RpcEndpoint {
  url: string;
  chain: string;
  latencyMs: number;
  consecutiveFailures: number;
  active: boolean;
  lastChecked: number;
}

// Seeded with public fallback nodes — ALCHEMY_API_KEY replaces if available
const ALCHEMY_KEY = process.env["Alchemy_API_Key"] ?? "";

function buildEndpoints(): RpcEndpoint[] {
  const endpoints: RpcEndpoint[] = [];
  const push = (chain: string, url: string) =>
    endpoints.push({ url, chain, latencyMs: 100, consecutiveFailures: 0, active: true, lastChecked: 0 });

  if (ALCHEMY_KEY) {
    push("ethereum",  `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
    push("polygon",   `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
    push("arbitrum",  `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
    push("optimism",  `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
    push("avalanche", `https://avax-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
  }

  // Public fallbacks
  push("ethereum",  "https://cloudflare-eth.com");
  push("polygon",   "https://polygon-rpc.com");
  push("arbitrum",  "https://arb1.arbitrum.io/rpc");
  push("optimism",  "https://mainnet.optimism.io");
  push("avalanche", "https://api.avax.network/ext/bc/C/rpc");
  push("bsc",       "https://bsc-dataseed1.binance.org");

  return endpoints;
}

const endpoints = buildEndpoints();
const activeByChain = new Map<string, string>(); // chain → active URL

// ── Latency measurement ───────────────────────────────────────────────────────

async function probeEndpoint(ep: RpcEndpoint): Promise<number> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(ep.url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal:  controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const latency = Date.now() - start;
    ep.latencyMs = latency;
    ep.consecutiveFailures = 0;
    ep.active = true;
    return latency;
  } catch {
    ep.consecutiveFailures++;
    if (ep.consecutiveFailures >= 3) ep.active = false;
    return Infinity;
  } finally {
    ep.lastChecked = Date.now();
  }
}

async function probeChain(chain: string): Promise<void> {
  const chainEps = endpoints.filter(e => e.chain === chain);
  if (chainEps.length === 0) return;

  const results = await Promise.all(chainEps.map(ep => probeEndpoint(ep)));
  const best = chainEps
    .map((ep, i) => ({ ep, latency: results[i] }))
    .filter(r => r.latency !== Infinity)
    .sort((a, b) => a.latency - b.latency)[0];

  if (!best) return;

  const prevActive = activeByChain.get(chain);
  activeByChain.set(chain, best.ep.url);

  if (prevActive && prevActive !== best.ep.url) {
    console.log(`[LIIL] Switched ${chain} RPC: ${best.ep.url.replace(/\/v2\/.*/, "/v2/…")} (${best.latency}ms)`);
    eventBus.publish(MODULE, "liil.rpc_switched", { chain, newUrl: best.ep.url, latencyMs: best.latency }, { priority: "normal" });
  }

  if (best.latency > moduleConfig.LIIL_DEGRADED_MS) {
    eventBus.publish(MODULE, "liil.latency_degraded", { chain, latencyMs: best.latency }, { priority: "high" });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getLIILLatency(chain: string): number {
  const chainEps = endpoints.filter(e => e.chain === chain && e.active);
  if (chainEps.length === 0) return 500;
  return Math.min(...chainEps.map(e => e.latencyMs));
}

export function getActiveRpc(chain: string): string | undefined {
  return activeByChain.get(chain);
}

export function getLIILStatus(): Record<string, { latencyMs: number; activeUrl: string; healthy: boolean }> {
  const chains = [...new Set(endpoints.map(e => e.chain))];
  const result: Record<string, { latencyMs: number; activeUrl: string; healthy: boolean }> = {};
  for (const chain of chains) {
    const latency = getLIILLatency(chain);
    result[chain] = {
      latencyMs:  latency,
      activeUrl:  activeByChain.get(chain) ?? "none",
      healthy:    latency < moduleConfig.LIIL_FAILED_MS,
    };
  }
  return result;
}

// ── Health ─────────────────────────────────────────────────────────────────────

const startTime = Date.now();

export function getLIILHealth(): ModuleHealth {
  const status = getLIILStatus();
  const degraded = Object.values(status).some(s => !s.healthy);
  return {
    name: MODULE,
    status: degraded ? "degraded" : "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - startTime,
    metadata: { chainCount: Object.keys(status).length, rpcEndpoints: endpoints.length },
  };
}

// ── Background loop ────────────────────────────────────────────────────────────

const CHAINS = ["ethereum", "polygon", "arbitrum", "optimism", "avalanche", "bsc"];

async function runProbe(): Promise<void> {
  await Promise.allSettled(CHAINS.map(chain => probeChain(chain)));
}

export function startLIIL(): void {
  if (!moduleConfig.ENABLE_LIIL) {
    console.log("[LIIL] Disabled via feature flag");
    // Seed defaults so MPEA never gets undefined
    for (const chain of CHAINS) activeByChain.set(chain, "fallback");
    return;
  }
  // Seed default latencies immediately (before first probe)
  for (const chain of CHAINS) activeByChain.set(chain, endpoints.find(e => e.chain === chain)?.url ?? "fallback");
  console.log(`[LIIL] Latency Intelligence Layer started — probing ${CHAINS.length} chains every 30s`);
  setTimeout(() => runProbe(), 5_000);
  setInterval(() => runProbe(), 30_000);
}
