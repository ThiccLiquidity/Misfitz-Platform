// Feature flags / tunables. Kept in one place so behaviour can be flipped without code spelunking.

// Comparable-sales valuation (src/lib/valuation/comps.ts). When ON, the live collection blends
// sales-derived values into the fair-value estimate, weighted by confidence, with the existing
// floor+premium estimate as the graceful fallback. OFF = exactly the prior behaviour.
//
// Default ON. To turn it OFF, set VALUATION_COMPS_ENABLED="false" (env) — or just say so and I flip
// this one line. Server-only flag.
export function isCompsEnabled(): boolean {
  return process.env.VALUATION_COMPS_ENABLED !== "false";
}
