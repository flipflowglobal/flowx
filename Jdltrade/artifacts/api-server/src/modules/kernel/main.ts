/**
 * Self-Healing System Kernel
 *
 * Watchdog that monitors all 12 intelligence modules.
 * Detects failed/stale modules and triggers restart via registered restart functions.
 * Maintains a system-wide health snapshot.
 *
 * Publishes: kernel.module_restarted | kernel.module_failed | kernel.health_report
 */

import { eventBus } from "../shared/event-bus.js";
import { moduleConfig } from "../shared/config.js";
import type { ModuleHealth, ModuleStatus } from "../shared/types.js";

const MODULE = "Kernel";

// ── Module registry ───────────────────────────────────────────────────────────

interface RegisteredModule {
  name: string;
  getHealth: () => ModuleHealth;
  restart:   () => void | Promise<void>;
  restartCount: number;
  lastRestartAt?: number;
}

const registry = new Map<string, RegisteredModule>();

export function registerModule(
  name: string,
  getHealth: () => ModuleHealth,
  restart: () => void | Promise<void>
): void {
  registry.set(name, { name, getHealth, restart, restartCount: 0 });
}

// ── Health snapshot ───────────────────────────────────────────────────────────

export interface SystemHealthSnapshot {
  timestamp: string;
  overallStatus: "healthy" | "degraded" | "critical";
  modules: ModuleHealth[];
  failedModules: string[];
  uptimeMs: number;
}

function buildSnapshot(): SystemHealthSnapshot {
  const modules: ModuleHealth[] = [];
  const failedModules: string[] = [];

  for (const reg of registry.values()) {
    try {
      const health = reg.getHealth();
      modules.push(health);
      if (health.status === "failed") failedModules.push(reg.name);
    } catch (err: any) {
      modules.push({
        name: reg.name,
        status: "failed",
        lastHeartbeat: new Date().toISOString(),
        errorCount: 1,
        lastError: err?.message,
        uptimeMs: 0,
      });
      failedModules.push(reg.name);
    }
  }

  const criticalCount = failedModules.length;
  const degradedCount = modules.filter(m => m.status === "degraded").length;

  const overallStatus: SystemHealthSnapshot["overallStatus"] =
    criticalCount >= 3 ? "critical"
    : criticalCount > 0 || degradedCount >= 2 ? "degraded"
    : "healthy";

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    modules,
    failedModules,
    uptimeMs: Date.now() - kernelStartTime,
  };
}

let latestSnapshot: SystemHealthSnapshot | null = null;

export function getSystemHealth(): SystemHealthSnapshot {
  return latestSnapshot ?? buildSnapshot();
}

// ── Watchdog loop ─────────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = moduleConfig.KERNEL_HEARTBEAT_MS * 3;

async function watchdogCycle(): Promise<void> {
  const snapshot = buildSnapshot();
  latestSnapshot = snapshot;

  for (const mod of snapshot.modules) {
    if (mod.status === "disabled") continue;

    const reg = registry.get(mod.name);
    if (!reg) continue;

    const heartbeatAge = Date.now() - new Date(mod.lastHeartbeat).getTime();
    const isStale = heartbeatAge > STALE_THRESHOLD_MS;
    const isFailed = mod.status === "failed";

    if ((isFailed || isStale) && reg.restartCount < moduleConfig.KERNEL_MAX_RESTARTS) {
      const reason = isFailed ? "failed status" : `stale heartbeat (${(heartbeatAge / 1000).toFixed(0)}s)`;
      console.warn(`[Kernel] Restarting module ${mod.name} — ${reason} (attempt ${reg.restartCount + 1})`);

      try {
        await reg.restart();
        reg.restartCount++;
        reg.lastRestartAt = Date.now();
        eventBus.publish(MODULE, "kernel.module_restarted",
          { module: mod.name, reason, restartCount: reg.restartCount },
          { priority: "high" }
        );
      } catch (err: any) {
        console.error(`[Kernel] Failed to restart ${mod.name}:`, err?.message);
        eventBus.publish(MODULE, "kernel.module_failed",
          { module: mod.name, error: err?.message },
          { priority: "critical" }
        );
      }
    } else if ((isFailed || isStale) && reg.restartCount >= moduleConfig.KERNEL_MAX_RESTARTS) {
      console.error(`[Kernel] Module ${mod.name} exceeded max restarts (${moduleConfig.KERNEL_MAX_RESTARTS}) — giving up`);
    }
  }

  // Emit periodic health report
  eventBus.publish(MODULE, "kernel.health_report",
    { snapshot },
    { priority: "low" }
  );

  if (snapshot.overallStatus !== "healthy") {
    console.log(
      `[Kernel] System ${snapshot.overallStatus.toUpperCase()} — ` +
      `${snapshot.failedModules.length} failed, ${snapshot.modules.filter(m => m.status === "degraded").length} degraded`
    );
  }
}

// ── Kernel own health ──────────────────────────────────────────────────────────

const kernelStartTime = Date.now();

export function getKernelHealth(): ModuleHealth {
  return {
    name: MODULE,
    status: "running",
    lastHeartbeat: new Date().toISOString(),
    errorCount: 0,
    uptimeMs: Date.now() - kernelStartTime,
    metadata: {
      registeredModules: registry.size,
      overallStatus: latestSnapshot?.overallStatus ?? "unknown",
    },
  };
}

export function startKernel(): void {
  if (!moduleConfig.ENABLE_KERNEL) {
    console.log("[Kernel] Disabled via feature flag");
    return;
  }
  console.log(`[Kernel] Self-Healing Kernel started — watchdog every ${moduleConfig.KERNEL_HEARTBEAT_MS / 1000}s`);
  setTimeout(watchdogCycle, 15_000);   // first check 15s after boot (modules need time to initialise)
  setInterval(watchdogCycle, moduleConfig.KERNEL_HEARTBEAT_MS);
}
