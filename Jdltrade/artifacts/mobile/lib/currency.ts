/**
 * JDL Currency Utilities — AUD display throughout the app
 * All internal values are stored in USD; this module converts for display.
 */

export const DEFAULT_USD_TO_AUD = 1.55;

export function usdToAud(usd: number, rate = DEFAULT_USD_TO_AUD): number {
  return usd * rate;
}

export function formatAUD(usd: number, rate = DEFAULT_USD_TO_AUD): string {
  const aud = usd * rate;
  const abs = Math.abs(aud);
  if (abs >= 1_000_000) return `A$${(aud / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `A$${(aud / 1_000).toFixed(1)}K`;
  return `A$${Math.abs(aud).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAUDFull(usd: number, rate = DEFAULT_USD_TO_AUD): string {
  const aud = usd * rate;
  return `A$${Math.abs(aud).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAUDCompact(usd: number, rate = DEFAULT_USD_TO_AUD): string {
  const aud = usd * rate;
  const abs = Math.abs(aud);
  if (abs >= 1_000_000) return `A$${(aud / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `A$${(aud / 1_000).toFixed(1)}K`;
  return `A$${aud.toFixed(0)}`;
}
