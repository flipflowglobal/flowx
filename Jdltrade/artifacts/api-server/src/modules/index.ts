/**
 * JDL Intelligence Module System — Bootstrap
 *
 * Starts all 12 modules in dependency order:
 *  1. Infrastructure first (LIIL — latency data for MPEA)
 *  2. Intelligence layers (MRIL, PLI — regime/liquidity for CSFC)
 *  3. Decision layer (CSFC, ARG, MPEA — gate inputs)
 *  4. Execution layer (AEE, MASEE, MEV, Shadow)
 *  5. Ops layer (GSRE, Kernel last — monitors everything)
 */

import { moduleConfig } from "./shared/config.js";
import {
  startLIIL,
  getLIILHealth,
  startMRIL,
  getMRILHealth,
  startPLI,
  getPLIHealth,
  startCSFC,
  getCSFCHealth,
  startARG,
  getARGHealth,
  startMPEA,
  getMPEAHealth,
  startAEE,
  getAEEHealth,
  startMASEE,
  getMASEEHealth,
  startMEV,
  getMEVHealth,
  startShadow,
  getShadowHealth,
  startGSRE,
  getGSREHealth,
  startKernel,
  getKernelHealth,
  registerModule,
  getSystemHealth,
} from "./re-exports.js";

export { getSystemHealth } from "./re-exports.js";
export { fuseSignals } from "./csfc/main.js";
export { evaluateRisk, activateKillSwitch, liftKillSwitch, isKillSwitchActive, reportLoss } from "./arg/main.js";
export { selectExecutionRoute } from "./mpea/main.js";
export { simulate as shadowSimulate, recordActualOutcome } from "./shadow/main.js";
export { assessMevRisk } from "./mev/main.js";
export { ingestPerformance as maseeIngest } from "./masee/main.js";
export { getRegime } from "./mril/main.js";
export type { GatedTradeDecision, TradeIntent } from "./shared/types.js";

export async function startAllModules(): Promise<void> {
  console.log("[Modules] Bootstrapping JDL Intelligence Module System…");

  // ── Tier 1: Infrastructure ───────────────────────────────────────────────
  startLIIL();   // RPC latency — must be first (MPEA reads LIIL latency)

  // ── Tier 2: Market intelligence ──────────────────────────────────────────
  startMRIL();   // Regime classification
  startPLI();    // Liquidity forecast

  // ── Tier 3: Decision/gate layer ──────────────────────────────────────────
  startCSFC();   // Signal fusion
  startARG();    // Risk governor + kill switch
  startMPEA();   // Execution routing

  // ── Tier 4: Execution intelligence ───────────────────────────────────────
  startAEE();    // Alpha scanning
  startMASEE();  // Strategy evolution
  startMEV();    // MEV defence

  // ── Tier 5: Simulation & ops ──────────────────────────────────────────────
  startShadow(); // Shadow simulation
  startGSRE();   // State reconciliation

  // ── Tier 6: Watchdog ──────────────────────────────────────────────────────
  // Register all modules with kernel BEFORE starting it
  registerModule("LIIL",   getLIILHealth,   startLIIL);
  registerModule("MRIL",   getMRILHealth,   startMRIL);
  registerModule("PLI",    getPLIHealth,    startPLI);
  registerModule("CSFC",   getCSFCHealth,   startCSFC);
  registerModule("ARG",    getARGHealth,    startARG);
  registerModule("MPEA",   getMPEAHealth,   startMPEA);
  registerModule("AEE",    getAEEHealth,    startAEE);
  registerModule("MASEE",  getMASEEHealth,  startMASEE);
  registerModule("MEV",    getMEVHealth,    startMEV);
  registerModule("Shadow", getShadowHealth, startShadow);
  registerModule("GSRE",   getGSREHealth,   startGSRE);

  startKernel(); // Starts last — monitors everything above

  const enabled = Object.entries(moduleConfig)
    .filter(([k, v]) => k.startsWith("ENABLE_") && v === true)
    .map(([k]) => k.replace("ENABLE_", ""))
    .join(", ");

  console.log(`[Modules] ${enabled.split(",").length} modules active: ${enabled}`);
}
