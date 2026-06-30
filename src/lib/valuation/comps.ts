// Sales-fitted VALUE CURVE (pure, unit-testable). One value per rarity rank, fit from the market:
//
//   • Plot every recent clean sale as (rank, price), recency-weighted.
//   • Anchor the common end to the floor; fill gaps with the rarity baseline (floor + floor×R).
//   • Each rank's "raw" value = recency × rank-proximity weighted AVERAGE of nearby sales, blended
//     with the baseline where sales are thin (the curve finds the AVERAGE on its way through sales).
//   • Enforce MONOTONICITY (isotonic / antitonic regression): rarer is never valued below a less-rare
//     recent sale, and the curve keeps climbing toward the top. Sales tug it up AND down, but it stays
//     a smooth, monotonic curve.
//
//   value(NFT) = curveValue(rank) × traitAmplifier(traits)   (+ collector-number premium, added by caller)
//
// The curve merges floor + rarity + comps into a single "curve score". Trait demand sits ON TOP.

export interface Trait { k: string; v: string }

export interface Sale { rank: number; price: number; ageDays: number; traits?: Trait[] }

export interface CompsValue {
  value: number | null;   // curveValue × traitFactor, or null
  curve: number | null;   // the rank-fitted curve value (pre-trait)
  traitFactor: number;    // trait amplifier applied (1 = none)
  confidence: number;     // 0..maxPull — local recent-sales support at this rank
  basis: string;
}

export interface TraitStat { mult: number; n: number; reliability: number; penalty: number }

export interface CompsModel {
  totalSupply: number;
  sampleSize: number;
  bandwidth: number;
  rankCurve(rank: number): number | null;   // raw local sales value (pre-monotonic)
  curveValue(rank: number): number;          // monotonic merged curve score
  traitMult(k: string, v: string): TraitStat;
  valueOf(rank: number | null, traits?: Trait[]): CompsValue;
}

export interface CompsOptions {
  halfLifeDays?: number;
  reliabilityK?: number;
  minTraitN?: number;
  traitFactorClamp?: [number, number];
  bandwidth?: number;
  pullK?: number;
  maxPull?: number;
  floor?: number;                                  // collection floor (anchors the common end)
  rarityFactor?: (percentilePct: number) => number; // baseline rarity multiple (× floor), percentile in %
}

function key(k: string, v: string): string { return `${k.trim().toLowerCase()}=${v.trim().toLowerCase()}`; }
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function weightedMedian(pairs: { x: number; w: number }[]): number | null {
  const pts = pairs.filter((p) => p.w > 0);
  if (pts.length === 0) return null;
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const total = sorted.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return sorted[Math.floor(sorted.length / 2)].x;
  let acc = 0;
  for (const p of sorted) { acc += p.w; if (acc >= total / 2) return p.x; }
  return sorted[sorted.length - 1].x;
}
function plainMedian(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildCompsModel(sales: Sale[], totalSupply: number, opts: CompsOptions = {}): CompsModel | null {
  const halfLife = opts.halfLifeDays ?? 120;
  const reliabilityK = opts.reliabilityK ?? 12;
  const minTraitN = opts.minTraitN ?? 3;
  const [clampLo, clampHi] = opts.traitFactorClamp ?? [0.6, 3.0];
  const supply = Math.max(1, Math.floor(totalSupply) || 0);
  const bandwidth = opts.bandwidth ?? Math.max(supply * 0.005, 50);
  const pullK = opts.pullK ?? 0.12;
  const maxPull = opts.maxPull ?? 0.95;
  const floor = opts.floor && opts.floor > 0 ? opts.floor : 0;
  const rarityFactor = opts.rarityFactor ?? (() => 0);

  const usable = sales.filter((s) => Number.isFinite(s.rank) && s.rank > 0 && Number.isFinite(s.price) && s.price > 0);
  if (usable.length === 0) return null;

  const weightOf = (ageDays: number) => Math.pow(0.5, Math.max(0, ageDays) / halfLife);
  const points = usable.map((s) => ({ rank: s.rank, price: s.price, w: weightOf(s.ageDays), traits: s.traits ?? [] }));

  const rankCurve = (rank: number): number | null =>
    weightedMedian(points.map((p) => ({ x: p.price, w: p.w * Math.exp(-Math.abs(p.rank - rank) / bandwidth) })));

  const localPull = (rank: number): number => {
    let tw = 0;
    for (const p of points) tw += p.w * Math.exp(-Math.abs(p.rank - rank) / bandwidth);
    return clamp(tw / (tw + pullK), 0, maxPull);
  };

  // Per-trait stats (vs the local rank value), with reliability + rank-correlation penalty.
  const acc = new Map<string, { ratios: { x: number; w: number }[]; pcts: number[] }>();
  for (const p of points) {
    const base = rankCurve(p.rank);
    if (!base || base <= 0) continue;
    const pct = p.rank / supply;
    for (const t of p.traits) {
      const kk = key(t.k, t.v);
      let d = acc.get(kk); if (!d) { d = { ratios: [], pcts: [] }; acc.set(kk, d); }
      d.ratios.push({ x: p.price / base, w: p.w }); d.pcts.push(pct);
    }
  }
  const traitStats = new Map<string, TraitStat>();
  for (const [kk, d] of acc) {
    const mult = weightedMedian(d.ratios) ?? 1;
    const n = d.ratios.length;
    const medPct = plainMedian(d.pcts);
    traitStats.set(kk, { mult, n, reliability: n / (n + reliabilityK), penalty: medPct < 0.10 ? 0.5 : medPct < 0.25 ? 0.75 : 1.0 });
  }
  const traitMult = (k: string, v: string): TraitStat => traitStats.get(key(k, v)) ?? { mult: 1, n: 0, reliability: 0, penalty: 1 };

  // ── Build the monotonic value curve over a grid (sale ranks + a percentile grid) ────────────────
  const baseAt = (rank: number) => floor + floor * rarityFactor(clamp((rank / supply) * 100, 0, 100));
  const gridSet = new Set<number>();
  for (const p of points) gridSet.add(Math.round(p.rank));
  for (let pc = 1; pc <= 100; pc++) gridSet.add(Math.max(1, Math.round((pc / 100) * supply)));
  const grid = [...gridSet].sort((a, b) => a - b);
  const vpts = grid.map((rank) => {
    const pull = localPull(rank);
    const lc = rankCurve(rank);
    const v = lc != null ? pull * lc + (1 - pull) * baseAt(rank) : baseAt(rank);
    return { rank, val: Math.max(floor, v), w: 0.05 + pull }; // sale-backed points weighted higher
  });
  // Monotonic non-increasing in rank via cumulative MAX from the common end: a sale at a rank lifts
  // everything rarer to at least its value (your rule: nothing rarer is cheaper), and never lowers the
  // sale itself. Down-adjustments survive (a low-selling band stays low unless a less-rare rank is higher).
  const byRank = [...vpts].sort((a, b) => a.rank - b.rank);
  const mono: { rank: number; val: number }[] = new Array(byRank.length);
  let runMax = -Infinity;
  for (let i = byRank.length - 1; i >= 0; i--) { runMax = Math.max(runMax, byRank[i].val); mono[i] = { rank: byRank[i].rank, val: runMax }; }

  function curveValue(rank: number): number {
    if (mono.length === 0) return Math.max(floor, baseAt(rank));
    if (rank <= mono[0].rank) return mono[0].val;
    if (rank >= mono[mono.length - 1].rank) return mono[mono.length - 1].val;
    let lo = 0, hi = mono.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (mono[mid].rank <= rank) lo = mid; else hi = mid; }
    const a = mono[lo], b = mono[hi];
    const t = b.rank === a.rank ? 0 : (rank - a.rank) / (b.rank - a.rank);
    return a.val + t * (b.val - a.val);
  }

  function valueOf(rank: number | null, traits?: Trait[]): CompsValue {
    if (rank == null || !Number.isFinite(rank)) return { value: null, curve: null, traitFactor: 1, confidence: 0, basis: "no rank" };
    const curve = curveValue(rank);
    let logScore = 0;
    const drivers: { kv: string; mult: number; n: number; contrib: number }[] = [];
    for (const t of traits ?? []) {
      const m = traitMult(t.k, t.v);
      if (m.n >= minTraitN && m.mult > 0 && m.mult !== 1) {
        const contrib = Math.log(m.mult) * m.reliability * m.penalty;
        logScore += contrib;
        drivers.push({ kv: `${t.k}:${t.v}`, mult: m.mult, n: m.n, contrib });
      }
    }
    const traitFactor = clamp(Math.exp(logScore), clampLo, clampHi);
    const value = curve * traitFactor;
    drivers.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
    const top = drivers[0];
    const basis = top
      ? `market curve ≈ ${Math.round(curve * 100) / 100} XCH · ${top.kv} ×${traitFactor.toFixed(2)} (n=${top.n})`
      : `market curve ≈ ${Math.round(curve * 100) / 100} XCH (rank-fitted from sales)`;
    return { value, curve, traitFactor, confidence: localPull(rank), basis };
  }

  return { totalSupply: supply, sampleSize: usable.length, bandwidth, rankCurve, curveValue, traitMult, valueOf };
}
