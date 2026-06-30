// Comparable-sales valuation model (pure, no imports — directly unit-testable with `node --test`).
//
// The "everything works off itself" model the product owner described, built only from real sales:
//
//   1. rankCurve(rank)      — value implied by rarity POSITION. A k-nearest-by-rank, recency-weighted
//                             median of actual sale prices, so value flows continuously up and down the
//                             collection even for ranks that have never sold ("similar rarity within a tier").
//   2. traitMult(k, v)      — how much a SPECIFIC trait beats (or drags) what its rank alone predicts:
//                             median(sale / rankCurve(rank)) over sales carrying that trait, shrunk toward
//                             1.0 when the sample is thin so a single sale can't swing it.
//   3. valueOf(rank,traits) — rankCurve(rank) adjusted by its traits' (capped) combined multiplier, with a
//                             0..1 confidence from how much recent nearby evidence backs it.
//
// The caller blends valueOf().value with the existing floor+premium estimate by confidence, so thin data
// degrades gracefully back to the old prior — comps only override where the evidence is real.

export interface Trait { k: string; v: string }

export interface Sale {
  rank: number;       // OpenRarity rank (1 = rarest)
  price: number;      // clean XCH sale price
  ageDays: number;    // days since the sale (for recency weighting)
  traits?: Trait[];   // traits of the sold NFT (optional — omit to build a rank-only model)
}

export interface CompsValue {
  value: number | null;   // sales-implied value in XCH, or null if no usable curve
  confidence: number;     // 0..1 — how strongly real sales back this number
  basis: string;          // short human note: what drove the value
}

export interface CompsModel {
  sampleSize: number;                 // sales used
  withTraits: number;                 // sales that carried traits
  rankCurve(rank: number): number | null;
  traitMult(k: string, v: string): { mult: number; n: number };
  valueOf(rank: number | null, traits?: Trait[]): CompsValue;
}

export interface CompsOptions {
  halfLifeDays?: number;  // recency decay half-life (default 120)
  k?: number;             // neighbours for the rank curve (default 25)
  traitShrink?: number;   // shrink constant for trait multipliers (default 8)
  minTraitN?: number;     // ignore trait premiums with fewer sales (default 3)
  traitFactorClamp?: [number, number]; // clamp combined trait factor (default [0.4, 5])
}

function key(k: string, v: string): string {
  return `${k.trim().toLowerCase()}=${v.trim().toLowerCase()}`;
}

// Weighted median: smallest x where cumulative weight reaches half the total.
function weightedMedian(pairs: { x: number; w: number }[]): number | null {
  if (pairs.length === 0) return null;
  const sorted = [...pairs].sort((a, b) => a.x - b.x);
  const total = sorted.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return weightedMedian(sorted.map((p) => ({ x: p.x, w: 1 })));
  let acc = 0;
  for (const p of sorted) {
    acc += p.w;
    if (acc >= total / 2) return p.x;
  }
  return sorted[sorted.length - 1].x;
}

export function buildCompsModel(sales: Sale[], opts: CompsOptions = {}): CompsModel | null {
  const halfLife = opts.halfLifeDays ?? 120;
  const K = opts.k ?? 25;
  const traitShrink = opts.traitShrink ?? 8;
  const minTraitN = opts.minTraitN ?? 3;
  const [clampLo, clampHi] = opts.traitFactorClamp ?? [0.4, 5];

  const usable = sales.filter((s) => Number.isFinite(s.rank) && s.rank > 0 && Number.isFinite(s.price) && s.price > 0);
  if (usable.length === 0) return null;

  const weightOf = (ageDays: number) => Math.pow(0.5, Math.max(0, ageDays) / halfLife);
  const points = usable
    .map((s) => ({ rank: s.rank, price: s.price, w: weightOf(s.ageDays), traits: s.traits ?? [] }))
    .sort((a, b) => a.rank - b.rank);

  function rankCurve(rank: number): number | null {
    if (points.length === 0) return null;
    // k nearest by |rank distance|, weighted median of their prices (recency weighted).
    const near = [...points].sort((a, b) => Math.abs(a.rank - rank) - Math.abs(b.rank - rank)).slice(0, K);
    return weightedMedian(near.map((p) => ({ x: p.price, w: p.w })));
  }

  // Per-trait multiplier vs the rank curve's expectation.
  const traitBuckets = new Map<string, { x: number; w: number }[]>();
  let withTraits = 0;
  for (const p of points) {
    if (p.traits.length > 0) withTraits++;
    const base = rankCurve(p.rank);
    if (!base || base <= 0) continue;
    for (const t of p.traits) {
      const kk = key(t.k, t.v);
      if (!traitBuckets.has(kk)) traitBuckets.set(kk, []);
      traitBuckets.get(kk)!.push({ x: p.price / base, w: p.w });
    }
  }
  const traitMults = new Map<string, { mult: number; n: number }>();
  for (const [kk, ratios] of traitBuckets) {
    const raw = weightedMedian(ratios) ?? 1;
    const n = ratios.length;
    const shrunk = 1 + (raw - 1) * (n / (n + traitShrink)); // toward 1.0 when thin
    traitMults.set(kk, { mult: shrunk, n });
  }

  function traitMult(k: string, v: string): { mult: number; n: number } {
    return traitMults.get(key(k, v)) ?? { mult: 1, n: 0 };
  }

  // Confidence: how many recent sales sit near this rank (windowed), squashed to 0..1.
  function confidenceAt(rank: number): number {
    let wsum = 0;
    for (const p of points) {
      const dist = Math.abs(p.rank - rank);
      if (dist <= K * 4) wsum += p.w * (1 - dist / (K * 4)); // closer + fresher = more
    }
    return Math.max(0, Math.min(1, wsum / 6)); // ~6 weighted nearby sales => full confidence
  }

  function valueOf(rank: number | null, traits?: Trait[]): CompsValue {
    if (rank == null || !Number.isFinite(rank)) return { value: null, confidence: 0, basis: "no rank" };
    const base = rankCurve(rank);
    if (base == null) return { value: null, confidence: 0, basis: "no comps" };

    let factor = 1;
    let drivers: { kv: string; mult: number; n: number }[] = [];
    for (const t of traits ?? []) {
      const m = traitMult(t.k, t.v);
      if (m.n >= minTraitN && m.mult !== 1) {
        factor *= m.mult;
        drivers.push({ kv: `${t.k}:${t.v}`, mult: m.mult, n: m.n });
      }
    }
    factor = Math.max(clampLo, Math.min(clampHi, factor));
    const value = base * factor;

    drivers.sort((a, b) => Math.abs(b.mult - 1) - Math.abs(a.mult - 1));
    const top = drivers[0];
    const basis = top
      ? `rank≈${Math.round(base * 100) / 100} XCH, ${top.kv} ${top.mult >= 1 ? "+" : ""}${Math.round((top.mult - 1) * 100)}% (n=${top.n})`
      : `rank≈${Math.round(base * 100) / 100} XCH`;

    return { value, confidence: confidenceAt(rank), basis };
  }

  return { sampleSize: usable.length, withTraits, rankCurve, traitMult, valueOf };
}
