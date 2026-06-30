// Comparable-sales valuation model (pure, no imports — directly unit-testable with `node --test`).
//
// Pipeline (see Traitfolio-Valuation-Formula-Technical.md):
//   rankCurve(rank)  — recency × rank-distance weighted median of real sale prices.
//   traitFactor      — LOG-SPACE stack of per-trait multipliers, each damped by reliability and a
//                      rank-correlation penalty, then exp() and clamped to [0.6, 3.0]. This stops a few
//                      thin/correlated trait sales from exploding the high end.
//   compsValue       — rankCurve × traitFactor.
//   confidence       — nearby-sales support (0..1). The caller squares it and caps the comps pull
//                      before blending with the floor+premium base estimate.

export interface Trait { k: string; v: string }

export interface Sale {
  rank: number;     // OpenRarity rank (1 = rarest)
  price: number;    // clean XCH sale price
  ageDays: number;  // days since the sale (recency weighting)
  traits?: Trait[];
}

export interface CompsValue {
  value: number | null; // sales-implied compsValue in XCH (NOT yet blended/capped), or null
  confidence: number;   // 0..1 raw nearby-sales support (caller squares this)
  basis: string;        // short human note
}

export interface TraitStat { mult: number; n: number; reliability: number; penalty: number }

export interface CompsModel {
  totalSupply: number;
  sampleSize: number;
  withTraits: number;
  bandwidth: number;
  rankCurve(rank: number): number | null;
  traitMult(k: string, v: string): TraitStat;
  valueOf(rank: number | null, traits?: Trait[]): CompsValue;
}

export interface CompsOptions {
  halfLifeDays?: number;          // recency half-life (default 120)
  reliabilityK?: number;          // trait reliability constant n/(n+K) (default 12)
  minTraitN?: number;             // ignore trait premiums below this many sales (default 3)
  traitFactorClamp?: [number, number]; // clamp exp(logScore) (default [0.6, 3.0])
  bandwidth?: number;             // rank-distance decay scale; default max(supply×0.01, 100)
}

function key(k: string, v: string): string { return `${k.trim().toLowerCase()}=${v.trim().toLowerCase()}`; }

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
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function buildCompsModel(sales: Sale[], totalSupply: number, opts: CompsOptions = {}): CompsModel | null {
  const halfLife = opts.halfLifeDays ?? 120;
  const reliabilityK = opts.reliabilityK ?? 12;
  const minTraitN = opts.minTraitN ?? 3;
  const [clampLo, clampHi] = opts.traitFactorClamp ?? [0.6, 3.0];

  const supply = Math.max(1, Math.floor(totalSupply) || 0);
  const bandwidth = opts.bandwidth ?? Math.max(supply * 0.01, 100);

  const usable = sales.filter((s) => Number.isFinite(s.rank) && s.rank > 0 && Number.isFinite(s.price) && s.price > 0);
  if (usable.length === 0) return null;

  const weightOf = (ageDays: number) => Math.pow(0.5, Math.max(0, ageDays) / halfLife);
  const points = usable.map((s) => ({ rank: s.rank, price: s.price, w: weightOf(s.ageDays), traits: s.traits ?? [] }));

  // ── Rank curve: recency × rank-distance decay weighted median ───────────────────────────────
  function rankCurve(rank: number): number | null {
    const pairs = points.map((p) => ({ x: p.price, w: p.w * Math.exp(-Math.abs(p.rank - rank) / bandwidth) }));
    return weightedMedian(pairs);
  }

  // ── Per-trait stats: raw multiplier (vs rank curve), reliability, rank-correlation penalty ──
  const acc = new Map<string, { ratios: { x: number; w: number }[]; pcts: number[] }>();
  let withTraits = 0;
  for (const p of points) {
    if (p.traits.length > 0) withTraits++;
    const base = rankCurve(p.rank);
    if (!base || base <= 0) continue;
    const pct = p.rank / supply;
    for (const t of p.traits) {
      const kk = key(t.k, t.v);
      let d = acc.get(kk);
      if (!d) { d = { ratios: [], pcts: [] }; acc.set(kk, d); }
      d.ratios.push({ x: p.price / base, w: p.w });
      d.pcts.push(pct);
    }
  }
  const traitStats = new Map<string, TraitStat>();
  for (const [kk, d] of acc) {
    const mult = weightedMedian(d.ratios) ?? 1;
    const n = d.ratios.length;
    const reliability = n / (n + reliabilityK);
    const medPct = plainMedian(d.pcts); // median rarity-percentile of sold NFTs carrying this trait
    const penalty = medPct < 0.10 ? 0.5 : medPct < 0.25 ? 0.75 : 1.0; // damp traits that ride on rarity
    traitStats.set(kk, { mult, n, reliability, penalty });
  }
  function traitMult(k: string, v: string): TraitStat {
    return traitStats.get(key(k, v)) ?? { mult: 1, n: 0, reliability: 0, penalty: 1 };
  }

  // ── Confidence: weighted count of recent sales near this rank, squashed to 0..1 ──────────────
  function confidenceAt(rank: number): number {
    let wsum = 0;
    const win = Math.max(100, bandwidth);
    for (const p of points) {
      const dist = Math.abs(p.rank - rank);
      if (dist <= win) wsum += p.w * (1 - dist / win);
    }
    return clamp(wsum / 6, 0, 1);
  }

  function valueOf(rank: number | null, traits?: Trait[]): CompsValue {
    if (rank == null || !Number.isFinite(rank)) return { value: null, confidence: 0, basis: "no rank" };
    const base = rankCurve(rank);
    if (base == null) return { value: null, confidence: 0, basis: "no comps" };

    let logScore = 0;
    const drivers: { kv: string; mult: number; n: number; contrib: number }[] = [];
    for (const t of traits ?? []) {
      const m = traitMult(t.k, t.v);
      if (m.n >= minTraitN && m.mult > 0 && m.mult !== 1) {
        const contrib = Math.log(m.mult) * m.reliability * m.penalty; // log-space, damped
        logScore += contrib;
        drivers.push({ kv: `${t.k}:${t.v}`, mult: m.mult, n: m.n, contrib });
      }
    }
    const traitFactor = clamp(Math.exp(logScore), clampLo, clampHi);
    const value = base * traitFactor;
    const confidence = confidenceAt(rank);

    drivers.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
    const top = drivers[0];
    const baseR = Math.round(base * 100) / 100;
    const basis = top
      ? `rank≈${baseR} XCH, ${top.kv} ${top.mult >= 1 ? "+" : ""}${Math.round((top.mult - 1) * 100)}% (n=${top.n}) · trait ×${traitFactor.toFixed(2)}`
      : `rank≈${baseR} XCH`;
    return { value, confidence, basis };
  }

  return { totalSupply: supply, sampleSize: usable.length, withTraits, bandwidth, rankCurve, traitMult, valueOf };
}
