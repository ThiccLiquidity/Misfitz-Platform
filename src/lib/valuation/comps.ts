// Market-adjusted rarity curve (pure, unit-testable). The model:
//
//   1. Baseline curve: floor + floor × R(percentile) × globalScale — anchored at the floor, steepening
//      nonlinearly toward the rarest, scaled by the overall market level.
//   2. Smooth fit: a Gaussian-kernel (recency × rank-distance) weighted regression of recent sales,
//      blended toward the baseline where sales are thin. Smooth "best average path", NOT raw averaging,
//      and NOT forced monotonic (a single outlier can't create a hard step).
//   3. curveValue(rank) = the market-adjusted price for an NFT of that rarity.
//   4. Premiums ON TOP, multiplicatively:
//        estimate = curveValue × traitDemandMult × collectorMult
//      • traitDemandMult: traits selling MORE OFTEN recently than their collection prevalence (volume,
//        not price) get a small bump. Only adds.
//      • collectorMult: applied by the caller from the collectible-number weight.

export interface Trait { k: string; v: string }
export interface Sale { rank: number; price: number; ageDays: number; traits?: Trait[] }

export interface CompsValue {
  value: number | null;  // curveValue × traitDemandMult (collector applied by caller), or null
  curve: number | null;  // the market-adjusted rarity-curve price (pre-premiums)
  traitMult: number;     // trait-demand multiplier (>= 1)
  confidence: number;    // 0..1 local sales support
  basis: string;
  traitTop?: string | null; // the single hottest trait driving the demand bump (e.g. "Background:Gold"), if any
}

export interface CompsModel {
  totalSupply: number;
  sampleSize: number;
  bandwidth: number;
  globalScale: number;
  curveValue(rank: number): number;
  traitDemand(traits?: Trait[]): { mult: number; top?: { kv: string; ratio: number; n: number } };
  valueOf(rank: number | null, traits?: Trait[]): CompsValue;
  // Collection-wide: trait values selling hotter than their prevalence right now (normalized type/value).
  hotTraits(): { type: string; value: string; ratio: number }[];
}

export interface CompsOptions {
  halfLifeDays?: number;       // recency half-life for the price curve (default 120)
  demandHalfLifeDays?: number; // shorter half-life for trait "recent volume" (default 21)
  bandwidth?: number;          // Gaussian rank-distance scale (default max(supply×0.01, 100))
  pullK?: number;              // saturation: how much sales override baseline (default 0.6)
  maxPull?: number;            // cap on sales weight (default 0.92)
  floor?: number;
  rarityFactor?: (percentilePct: number) => number;
  traitFreq?: Record<string, Record<string, number>>; // collection trait counts (attributes_frequency_counts)
  demandDamp?: number;         // trait-demand sensitivity (default 0.16)
  maxTraitDemand?: number;     // cap on the combined trait-demand multiplier (default 1.6)
  minTraitN?: number;          // min trait sales to register demand (default 3)
}

const norm = (s: string) => s.trim().toLowerCase();
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function weightedMedian(pairs: { x: number; w: number }[]): number | null {
  const pts = pairs.filter((p) => p.w > 0);
  if (pts.length === 0) return null;
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const total = sorted.reduce((s, p) => s + p.w, 0);
  let acc = 0;
  for (const p of sorted) { acc += p.w; if (acc >= total / 2) return p.x; }
  return sorted[sorted.length - 1].x;
}

// Solve a 3x3 linear system A·x = g (Gaussian elimination, partial pivoting). Returns null if singular.
function solve3(A: number[][], g: number[]): [number, number, number] | null {
  const M = A.map((row, i) => [row[0], row[1], row[2], g[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= 3; k++) M[r][k] -= f * M[col][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

export function buildCompsModel(sales: Sale[], totalSupply: number, opts: CompsOptions = {}): CompsModel | null {
  const halfLife = opts.halfLifeDays ?? 120;
  const demandHalfLife = opts.demandHalfLifeDays ?? 21;
  const supply = Math.max(1, Math.floor(totalSupply) || 0);
  const bandwidth = opts.bandwidth ?? Math.max(supply * 0.01, 100);
  const pullK = opts.pullK ?? 0.6;
  const maxPull = opts.maxPull ?? 0.92;
  const floor = opts.floor && opts.floor > 0 ? opts.floor : 0;
  const rarityFactor = opts.rarityFactor ?? (() => 0);
  const traitFreq = opts.traitFreq;
  const demandDamp = opts.demandDamp ?? 0.16;
  const maxTraitDemand = opts.maxTraitDemand ?? 1.6;
  const minTraitN = opts.minTraitN ?? 3;

  const usable = sales.filter((s) => Number.isFinite(s.rank) && s.rank > 0 && Number.isFinite(s.price) && s.price > 0);
  if (usable.length === 0) return null;

  const wRec = (ageDays: number, hl: number) => Math.pow(0.5, Math.max(0, ageDays) / hl);
  const points = usable.map((s) => ({
    rank: s.rank, price: s.price,
    w: wRec(s.ageDays, halfLife),         // price-curve recency
    wd: wRec(s.ageDays, demandHalfLife),  // trait-volume recency
    traits: s.traits ?? [],
  }));

  // ── Parabolic rarity curve, fit to sales ────────────────────────────────────────────────────────
  // The value curve is ALWAYS a smooth rarity parabola in rarity-space:
  //     value(rank) = a + b·rf + c·rf²         (rf = rarityFactor(percentile); high for rare, 0 for common)
  // Because rf is itself a curved function of rank, this is a smooth parabola in RANK. Recent sales don't
  // bend it point-by-point (that made "waves"); they fit its three coefficients by recency-weighted least
  // squares with a RIDGE PRIOR toward the floor-anchored rarity baseline (a≈floor, b≈floor, c≈0). So the
  // sales pull and tug the whole parabola — a cluster of strong rare sales steepens it, mid sales lift it —
  // but sparse/noisy sales stay near the baseline and it always resolves to one clean parabola. b,c are
  // clamped ≥0 so it's monotonic (rarer ≥ less-rare); an off-curve sale is a DEAL, never a dent.
  const rfAt = (rank: number) => rarityFactor(clamp((rank / supply) * 100, 0, 100));
  let a = floor, b = floor, c = 0;
  if (floor > 0 && points.length > 0) {
    const prior: [number, number, number] = [floor, floor, 0];
    const lambda = 0.7; // pull toward the baseline parabola (≈ this many effective sales of regularization)
    const A = [[lambda, 0, 0], [0, lambda, 0], [0, 0, lambda]];
    const g: [number, number, number] = [lambda * prior[0], lambda * prior[1], lambda * prior[2]];
    for (const p of points) {
      const rf = rfAt(p.rank);
      const ph = [1, rf, rf * rf];
      const w = p.w;
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += w * ph[i] * ph[j]; g[i] += w * ph[i] * p.price; }
    }
    const sol = solve3(A, g);
    if (sol) { a = sol[0]; b = Math.max(0, sol[1]); c = Math.max(0, sol[2]); }
  }
  const globalScale = floor > 0 ? (a + b + c) / floor : 1; // rough curve-level indicator for diagnostics

  function curveValue(rank: number): number {
    const rf = rfAt(rank);
    return Math.max(floor, a + b * rf + c * rf * rf);
  }

  function supportAt(rank: number): number {
    let sw = 0;
    for (const p of points) { const d = p.rank - rank; sw += p.w * Math.exp(-(d * d) / (2 * bandwidth * bandwidth)); }
    return clamp(sw / (sw + pullK), 0, maxPull);
  }

  // ── Trait demand from recent VOLUME: traits selling more often than their prevalence run hot ────
  const traitRecent = new Map<string, { w: number; n: number }>();
  let totalRecentW = 0;
  for (const p of points) {
    totalRecentW += p.wd;
    for (const t of p.traits) {
      const k = `${norm(t.k)}=${norm(t.v)}`;
      const e = traitRecent.get(k) ?? { w: 0, n: 0 };
      e.w += p.wd; e.n += 1; traitRecent.set(k, e);
    }
  }
  const freqOf = (k: string, v: string): number | null => {
    if (!traitFreq) return null;
    const cat = traitFreq[norm(k)] ?? traitFreq[k];
    if (!cat) return null;
    const c = cat[norm(v)] ?? cat[v];
    return typeof c === "number" && c > 0 ? c : null;
  };

  function traitDemand(traits?: Trait[]): { mult: number; top?: { kv: string; ratio: number; n: number } } {
    if (totalRecentW <= 0) return { mult: 1 };
    let logSum = 0;
    let top: { kv: string; ratio: number; n: number } | undefined;
    for (const t of traits ?? []) {
      const rec = traitRecent.get(`${norm(t.k)}=${norm(t.v)}`);
      if (!rec || rec.n < minTraitN) continue;
      const freq = freqOf(t.k, t.v);
      if (freq == null) continue;
      const expectedShare = freq / supply;            // how often it SHOULD appear in sales
      const observedShare = rec.w / totalRecentW;     // how often it DID, recently (recency-weighted)
      const ratio = observedShare / expectedShare;    // > 1 => selling hotter than its prevalence
      if (ratio <= 1) continue;                       // demand only ADDS
      const reliability = rec.n / (rec.n + 8);
      logSum += Math.log(ratio) * demandDamp * reliability;
      if (!top || ratio > top.ratio) top = { kv: `${t.k}:${t.v}`, ratio, n: rec.n };
    }
    return { mult: clamp(Math.exp(logSum), 1, maxTraitDemand), top };
  }

  // Collection-wide hot list for the filter bar: trait values with recent sale-share clearly above
  // their prevalence. Keys are normalized (lowercase) to match against trait options reliably.
  function hotTraits(): { type: string; value: string; ratio: number }[] {
    if (totalRecentW <= 0 || !traitFreq) return [];
    const out: { type: string; value: string; ratio: number }[] = [];
    for (const [kv, rec] of traitRecent) {
      if (rec.n < minTraitN) continue;
      const eq = kv.indexOf("=");
      if (eq < 0) continue;
      const type = kv.slice(0, eq);
      const value = kv.slice(eq + 1);
      const freq = freqOf(type, value);
      if (freq == null) continue;
      const ratio = (rec.w / totalRecentW) / (freq / supply);
      if (ratio > 1.15) out.push({ type, value, ratio }); // threshold: only clearly-hot surface a flame
    }
    return out.sort((a, b) => b.ratio - a.ratio);
  }

  function valueOf(rank: number | null, traits?: Trait[]): CompsValue {
    if (rank == null || !Number.isFinite(rank)) return { value: null, curve: null, traitMult: 1, confidence: 0, basis: "no rank" };
    const curve = curveValue(rank);
    const td = traitDemand(traits);
    const value = curve * td.mult;
    const basis = td.top
      ? `curve ≈ ${Math.round(curve * 100) / 100} XCH · ${td.top.kv} hot ×${td.mult.toFixed(2)} (n=${td.top.n})`
      : `curve ≈ ${Math.round(curve * 100) / 100} XCH (rarity curve fit to recent sales)`;
    return { value, curve, traitMult: td.mult, confidence: supportAt(rank), basis, traitTop: td.top ? td.top.kv : null };
  }

  return { totalSupply: supply, sampleSize: usable.length, bandwidth, globalScale, curveValue, traitDemand, valueOf, hotTraits };
}
