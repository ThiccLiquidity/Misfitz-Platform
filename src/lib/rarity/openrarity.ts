// OpenRarity ranking — the industry-standard information-content method (VALUATION.md Part 1).
// Intuition: measure how *surprising* each trait is, in bits, and sum the surprise across an NFT's
// traits. Rarer trait values carry more bits, so rarer NFTs score higher.
//
//   p(category = value) = count(value) / N            (N = supply; missing counts as "(none)")
//   IC(category = value) = -log2( p )                  (information content, in bits)
//   rarityScore(nft)     = Σ IC over all categories
//
// We rank by descending score. We MATCH this to MintGarden's openrarity_rank by using their rank
// when present; this module is for when we must compute it ourselves (e.g. a collection we index
// before it's on MintGarden). Normalizing by collection entropy doesn't change order, so we skip it.

export const NONE_VALUE = "(none)";

// A category is "degenerate" (an identifier like a serial number / image hash, not a real trait)
// when nearly every NFT has a distinct value. Excluded from scoring, ranking, and value math.
const DEGENERATE_RATIO = 0.5;

export interface RankableNft {
  id: string;
  // 1-indexed mint number, used only as a deterministic tie-breaker. Optional.
  mintNumber?: number | null;
  traits: { trait_type: string; value: string | number }[];
}

export interface OpenRarityResult {
  id: string;
  score: number; // total information content (bits)
  rank: number; // 1 = rarest
}

function log2(x: number): number {
  return Math.log(x) / Math.LN2;
}

// Build per-category value counts across the batch, treating a missing category as NONE_VALUE.
function buildCounts(nfts: RankableNft[]): Map<string, Map<string, number>> {
  const categories = new Set<string>();
  for (const nft of nfts) for (const t of nft.traits) categories.add(t.trait_type);

  const counts = new Map<string, Map<string, number>>();
  for (const cat of categories) counts.set(cat, new Map());

  for (const nft of nfts) {
    const present = new Map<string, string>();
    for (const t of nft.traits) present.set(t.trait_type, String(t.value));
    for (const cat of categories) {
      const value = present.get(cat) ?? NONE_VALUE;
      const m = counts.get(cat)!;
      m.set(value, (m.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

// Categories worth scoring — drops degenerate identifier-like categories.
function scorableCategories(counts: Map<string, Map<string, number>>, n: number): Set<string> {
  const keep = new Set<string>();
  for (const [cat, values] of counts) {
    if (values.size / n < DEGENERATE_RATIO) keep.add(cat);
  }
  return keep;
}

// Score one NFT against pre-built collection counts.
export function scoreNft(
  nft: RankableNft,
  counts: Map<string, Map<string, number>>,
  n: number,
  categories: Set<string>,
): number {
  const present = new Map<string, string>();
  for (const t of nft.traits) present.set(t.trait_type, String(t.value));

  let score = 0;
  for (const cat of categories) {
    const value = present.get(cat) ?? NONE_VALUE;
    const count = counts.get(cat)?.get(value) ?? 0;
    if (count > 0) score += -log2(count / n);
  }
  return score;
}

// Compute OpenRarity ranks for a full batch. Ties broken by ascending mint number (then id) so the
// ordering is stable and reproducible.
export function computeOpenRarityRanks(nfts: RankableNft[]): OpenRarityResult[] {
  const n = nfts.length;
  if (n === 0) return [];

  const counts = buildCounts(nfts);
  const categories = scorableCategories(counts, n);

  const scored = nfts.map((nft) => ({ id: nft.id, mintNumber: nft.mintNumber ?? null, score: scoreNft(nft, counts, n, categories) }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score; // higher score = rarer = better rank
    const am = a.mintNumber ?? Number.POSITIVE_INFINITY;
    const bm = b.mintNumber ?? Number.POSITIVE_INFINITY;
    if (am !== bm) return am - bm;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return scored.map((s, i) => ({ id: s.id, score: Math.round(s.score * 1000) / 1000, rank: i + 1 }));
}
