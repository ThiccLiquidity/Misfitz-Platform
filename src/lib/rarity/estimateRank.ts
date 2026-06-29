// Estimate an OpenRarity rank for a single NFT from a collection's trait-FREQUENCY table, for
// collections MintGarden hasn't ranked itself (openrarity_rank: null — common on Chia).
//
// We can't fetch all ~10k NFTs at request time, but the collection's attribute frequency counts
// fully describe the trait distribution. Under the standard OpenRarity independence assumption,
// an NFT's total rarity score is a sum of per-category information-content (IC) terms, each a
// discrete random variable whose distribution we know exactly from the counts. Convolving those
// per-category distributions yields the collection-wide score distribution — so for any NFT we
// compute its score and read off the fraction of the collection scoring at least as high. That
// fraction × supply is its estimated rank (1 = rarest). See VALUATION.md Part 1.
//
// Pure module: no imports, no path aliases — directly unit-testable with `node --test`.

export const NONE_VALUE = "(none)";

// Drop identifier-like categories (serial numbers, hashes) where almost every NFT is distinct.
const DEGENERATE_RATIO = 0.5;
// IC is bucketed to this resolution (bits) for the convolution. 0.01 bit is far finer than tier
// bands need, while keeping the support small enough to convolve quickly.
const BUCKET = 0.01;
const PRUNE = 1e-12;

// MintGarden shape: { category: { value: count } }. meta_trait:* are OpenRarity meta categories.
export type FrequencyCounts = Record<string, Record<string, number>>;
type Trait = { trait_type: string; value: string | number };

function log2(x: number): number {
  return Math.log(x) / Math.LN2;
}

// MintGarden's frequency table is lower-cased, but NFT metadata keeps original casing
// ("Background Color" / "Purple"). Normalize both sides so categories and values match.
function norm(s: string): string {
  return s.trim().toLowerCase();
}

export interface RankEstimator {
  totalSupply: number;
  /** Total information content (bits) for an NFT's traits. Higher = rarer. */
  scoreOf(traits: Trait[]): number;
  /** Estimated rank (1 = rarest), clamped to [1, totalSupply]. */
  rankOf(traits: Trait[]): number;
  /** Fraction of the collection scoring at least as high as `score` (0–1). */
  percentileOf(score: number): number;
}

interface PreparedCategory {
  // value -> count, including an implied NONE_VALUE bucket for NFTs lacking the category.
  counts: Map<string, number>;
}

// Build per-category count maps, filling the implied "(none)" bucket and dropping degenerate
// categories and OpenRarity meta categories (trait_count etc., which MintGarden's rank excludes).
function prepareCategories(freq: FrequencyCounts, n: number): Map<string, PreparedCategory> {
  const out = new Map<string, PreparedCategory>();
  for (const [rawCategory, values] of Object.entries(freq)) {
    if (rawCategory.startsWith("meta_trait:")) continue;
    const category = norm(rawCategory);
    const counts = new Map<string, number>();
    let sum = 0;
    let distinct = 0;
    for (const [value, count] of Object.entries(values)) {
      if (count <= 0) continue;
      counts.set(norm(value), (counts.get(norm(value)) ?? 0) + count);
      sum += count;
      distinct += 1;
    }
    if (sum < n) counts.set(NONE_VALUE, n - sum); // NFTs without this category
    if (counts.size === 0) continue;
    // Degenerate (identifier-like): nearly every NFT distinct within the population that has it.
    if (distinct / n >= DEGENERATE_RATIO) continue;
    out.set(category, { counts });
  }
  return out;
}

// Convolve per-category IC distributions into a single cumulative tail function over scores.
function buildScoreDistribution(
  categories: Map<string, PreparedCategory>,
  n: number,
): { tailAtOrAbove: (score: number) => number } {
  // dist: bucketed-IC (integer buckets) -> probability mass
  let dist = new Map<number, number>([[0, 1]]);
  for (const { counts } of categories.values()) {
    const next = new Map<number, number>();
    for (const [k, pk] of dist) {
      for (const c of counts.values()) {
        const ic = -log2(c / n);
        const bucket = k + Math.round(ic / BUCKET);
        const p = pk * (c / n);
        if (p < PRUNE) continue;
        next.set(bucket, (next.get(bucket) ?? 0) + p);
      }
    }
    dist = next;
  }

  // Sort buckets ascending and build a suffix-sum so tailAtOrAbove is O(log m).
  const buckets = [...dist.entries()].sort((a, b) => a[0] - b[0]);
  const keys = buckets.map((b) => b[0]);
  const suffix = new Array<number>(buckets.length + 1).fill(0);
  for (let i = buckets.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + buckets[i][1];

  return {
    tailAtOrAbove(score: number): number {
      const target = Math.round(score / BUCKET);
      // first index whose bucket >= target
      let lo = 0, hi = keys.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      return suffix[lo];
    },
  };
}

export function buildRankEstimator(freq: FrequencyCounts, totalSupply: number): RankEstimator | null {
  const n = Math.floor(totalSupply);
  if (!freq || n <= 0) return null;
  const categories = prepareCategories(freq, n);
  if (categories.size === 0) return null;
  const { tailAtOrAbove } = buildScoreDistribution(categories, n);

  function scoreOf(traits: Trait[]): number {
    const present = new Map<string, string>();
    for (const t of traits) present.set(norm(t.trait_type), norm(String(t.value)));
    let score = 0;
    for (const [category, { counts }] of categories) {
      const value = present.get(category) ?? NONE_VALUE;
      const count = counts.get(value);
      if (count && count > 0) score += -log2(count / n);
    }
    return score;
  }

  function percentileOf(score: number): number {
    return Math.min(1, Math.max(0, tailAtOrAbove(score)));
  }

  function rankOf(traits: Trait[]): number {
    const p = percentileOf(scoreOf(traits));
    return Math.min(n, Math.max(1, Math.round(p * n)));
  }

  return { totalSupply: n, scoreOf, rankOf, percentileOf };
}
