import type { NftData } from "@/types";
import { estimateFairValue } from "@/lib/valuation/estimate";
import { numberFromName, type Seed } from "./registry";

// Single source of truth for stamping a seeded collection's bundled OpenRarity rank + traits (+ per-trait
// rarity %) + baseline value onto a card, matched by mint number. Used IDENTICALLY by the collection page
// (buildBaseCollection), the wallet fast path (applySeedOverlay), and the wallet enrichment
// (enrichNftsByIds) — so all three always show the same numbers for the same NFT. Previously this logic
// lived in three hand-maintained copies; centralizing it removes the "fixed in 2 of 3 places" class of bug.

// The per-trait rarity-% function scans all ~10k seed entries to build its frequency table, so it's
// memoized per Seed object — callers that run per-chunk / per-wallet don't rebuild it every time.
const _pctCache = new WeakMap<Seed, (t: string, v: string) => number>();
export function seedPctFn(seed: Seed): (t: string, v: string) => number {
  const cached = _pctCache.get(seed);
  if (cached) return cached;
  const tf = new Map<string, number>();
  for (const key in seed.byNumber) {
    for (const [t, v] of seed.byNumber[key].traits) {
      const kk = `${t}|${v}`;
      tf.set(kk, (tf.get(kk) ?? 0) + 1);
    }
  }
  const fn = (t: string, v: string) => Math.round(((tf.get(`${t}|${v}`) ?? 0) / seed.supply) * 10000) / 100;
  _pctCache.set(seed, fn);
  return fn;
}

// Stamp seed data onto one card (mutates in place). Returns true if the card matched a seed entry.
// floorXch drives the baseline value recompute — MintGarden gives seeded NFTs no rank, so their fairValue
// must be rebuilt from the seed rank (falls back to the card's existing value if the estimate is null).
export function stampSeedOntoCard(
  card: NftData,
  seed: Seed,
  xchUsdRate: number,
  floorXch: number | null,
  pct: (t: string, v: string) => number = seedPctFn(seed),
): boolean {
  const num = numberFromName(card.name);
  const e = num != null ? seed.byNumber[String(num)] : undefined;
  if (!e) return false;
  card.rarityRank = e.rank;
  card.rankEstimated = false;
  card.totalSupply = seed.supply; // true mint supply so "#N of 10000" + tiers are exact
  card.traits = e.traits.map(([trait_type, value]) => ({ trait_type, value, rarityPercent: pct(trait_type, value) }));
  if (floorXch != null) {
    card.fairValue = estimateFairValue({ floorXch, rarityRank: e.rank, totalSupply: seed.supply, xchUsdRate }) ?? card.fairValue;
  }
  return true;
}
