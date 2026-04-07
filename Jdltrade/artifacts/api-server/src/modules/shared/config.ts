/**
 * Module Feature Flags
 * Read from environment — all default to true.
 * Set ENABLE_<MODULE>=false in .env to disable a module.
 */

function flag(key: string, defaultVal = true): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultVal;
  return val.toLowerCase() !== "false" && val !== "0";
}

export const moduleConfig = {
  ENABLE_MASEE:   flag("ENABLE_MASEE"),
  ENABLE_MRIL:    flag("ENABLE_MRIL"),
  ENABLE_MPEA:    flag("ENABLE_MPEA"),
  ENABLE_MEV:     flag("ENABLE_MEV"),
  ENABLE_GSRE:    flag("ENABLE_GSRE"),
  ENABLE_PLI:     flag("ENABLE_PLI"),
  ENABLE_ARG:     flag("ENABLE_ARG"),
  ENABLE_LIIL:    flag("ENABLE_LIIL"),
  ENABLE_SHADOW:  flag("ENABLE_SHADOW"),
  ENABLE_KERNEL:  flag("ENABLE_KERNEL"),
  ENABLE_CSFC:    flag("ENABLE_CSFC"),
  ENABLE_AEE:     flag("ENABLE_AEE"),

  // ARG risk limits
  ARG_MAX_POSITION_USD:      Number(process.env["ARG_MAX_POSITION_USD"]  ?? 50_000),
  ARG_MAX_DAILY_LOSS_USD:    Number(process.env["ARG_MAX_DAILY_LOSS_USD"] ?? 5_000),
  ARG_MAX_DRAWDOWN_PCT:      Number(process.env["ARG_MAX_DRAWDOWN_PCT"]   ?? 15),
  ARG_MIN_CONFIDENCE:        Number(process.env["ARG_MIN_CONFIDENCE"]     ?? 0.72),

  // CSFC minimum composite confidence to proceed
  CSFC_MIN_CONFIDENCE:       Number(process.env["CSFC_MIN_CONFIDENCE"]    ?? 0.70),

  // MPEA execution routing
  MPEA_MAX_GAS_USD:          Number(process.env["MPEA_MAX_GAS_USD"]       ?? 50),
  MPEA_MAX_SLIPPAGE_PCT:     Number(process.env["MPEA_MAX_SLIPPAGE_PCT"]  ?? 1.5),

  // LIIL latency thresholds
  LIIL_DEGRADED_MS:          Number(process.env["LIIL_DEGRADED_MS"]       ?? 800),
  LIIL_FAILED_MS:            Number(process.env["LIIL_FAILED_MS"]         ?? 2000),

  // Shadow engine
  SHADOW_DEVIATION_THRESHOLD: Number(process.env["SHADOW_DEVIATION_THRESHOLD"] ?? 0.15),

  // Kernel watchdog
  KERNEL_HEARTBEAT_MS:       Number(process.env["KERNEL_HEARTBEAT_MS"]    ?? 30_000),
  KERNEL_MAX_RESTARTS:       Number(process.env["KERNEL_MAX_RESTARTS"]    ?? 3),
} as const;
