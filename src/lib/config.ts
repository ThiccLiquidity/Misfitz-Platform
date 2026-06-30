// Feature flags / tunables. Kept in one place so behaviour can be flipped without code spelunking.

// Comparable-sales valuation (src/lib/valuation/comps.ts). When ON, the live collection blends
// sales-derived values into the fair-value estimate, weighted by confidence, with the existing
// floor+premium estimate as the graceful fallback. OFF = exactly the prior behaviour.
//
// Toggle via env: set VALUATION_COMPS_ENABLED=true in .env.local (default OFF). Server-only flag.
export function isCompsEnabled(): boolean {
  return process.env.VALUATION_COMPS_ENABLED === "true";
}
