// Runtime config for the adaptive (evidence-recency) half-life — see VALUATION-MODEL.md §5.P.
//
// ON by default (the live model). Per tier, a sale's memory is set by how far back you must reach through
// that tier's distinct-buyer sales to find enough evidence (liquid -> short, dead -> long); the §5 rarity
// parabola remains the fallback for tiers with no sales. To BACK IT OUT without a code change, set
// TRAITFOLIO_ADAPTIVE_HALFLIFE=0 and restart -- that returns the model to the fixed parabola exactly.
//
// LOCKED model (owner sign-off 2026-07-04). The three constants (N=7 / min=120 / max=540) are the accepted
// defaults; still overridable via env if a future backtest refines them.
// Server-side only (the comps model is built in compsService, off the request path).
import type { CompsOptions } from "@/lib/valuation/comps";

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Adaptive-half-life comps options. ON by default; TRAITFOLIO_ADAPTIVE_HALFLIFE=0 backs it out. */
export function adaptiveHalfLifeOptions(): Partial<CompsOptions> {
  if (process.env.TRAITFOLIO_ADAPTIVE_HALFLIFE === "0") return {};
  return {
    adaptiveHalfLife: true,
    adaptiveN: numEnv("TRAITFOLIO_ADAPTIVE_N", 7),
    adaptiveMinHalfLife: numEnv("TRAITFOLIO_ADAPTIVE_MIN", 120),
    adaptiveMaxHalfLife: numEnv("TRAITFOLIO_ADAPTIVE_MAX", 540),
  };
}
