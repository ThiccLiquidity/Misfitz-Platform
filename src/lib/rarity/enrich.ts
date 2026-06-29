// Derived/computed NFT fields — trait rarity %, composite rarity score, mock listing price, and
// deal score. None of this is raw chain data, so none of it lives in the database; it's computed
// once per request from whatever batch of NftData a DataSource/Prisma query already returned
// (ARCHITECTURE.md §7 — DB/fixtures stay "raw", presentation-layer math stays here). That keeps
// this collection-agnostic: it only ever reads the generic NftData/Trait shape, never anything
// Misfitz-specific, so it works unmodified for any future collection.
//
// Listing price and deal score are explicitly mocked (product decision, see chat) until a real
// marketplace/listings sync exists — swap computeListing's body for a live lookup later and every
// caller (card UI, detail modal) keeps working unchanged because the NftData shape doesn't move.

import type { DealScore, ListingData, NftData, Trait } from "@/types";
import { tierIdForPercentile, type RarityTierThresholds, type TierId } from "./tiers";

// Placeholder flat rate — there's no live price feed yet. Replace with a real XCH/USD lookup
// when one exists; every USD field on NftData/FairValueEstimate flows from this single constant.
export const MOCK_XCH_USD_RATE = 10.96;

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Tiny deterministic PRNG seeded from a string (the launcherId) so mock listing prices are
// stable across reloads/reseeds instead of jumping around on every page load.
function seededRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  // xorshift-ish mix, then normalize to [0, 1)
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return ((h >>> 0) % 10000) / 10000;
}

// What fraction of the batch shares each exact trait_type/value pair — real math on whatever
// NFTs are currently loaded, not invented data. Naturally gets more accurate as more of the
// collection is imported (matches the totalSupply-vs-nftCount distinction used elsewhere).
function computeTraitRarity(allNfts: NftData[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const nft of allNfts) {
    for (const trait of nft.traits) {
      const key = `${trait.trait_type}::${trait.value}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const percentByKey = new Map<string, number>();
  for (const [key, count] of counts) {
    percentByKey.set(key, round((count / allNfts.length) * 100, 1));
  }
  return percentByKey;
}

function attachTraitRarity(traits: Trait[], percentByKey: Map<string, number>): Trait[] {
  return traits.map((trait) => ({
    ...trait,
    rarityPercent: percentByKey.get(`${trait.trait_type}::${trait.value}`) ?? undefined,
  }));
}

// Mock composite score (0-100, higher = rarer) blending whole-NFT rank percentile with average
// trait rarity, so it reads as a distinct number from the percentile badge rather than a
// restatement of it — same spirit as OpenRarity's trait-information-content scores, simplified
// for v1. Replace with a real OpenRarity-style computation once full-collection trait stats
// (not just the loaded batch) are available.
function computeRarityScore(traits: Trait[], rank: number | null, totalSupply: number): number {
  const rankPercentile = rank && totalSupply > 0 ? (rank / totalSupply) * 100 : 50;
  const knownTraits = traits.filter((t) => typeof t.rarityPercent === "number");
  const traitAvgRarity =
    knownTraits.length > 0
      ? knownTraits.reduce((sum, t) => sum + (100 - (t.rarityPercent ?? 50)), 0) / knownTraits.length
      : 50;
  const score = 0.5 * (100 - rankPercentile) + 0.5 * traitAvgRarity;
  return round(clamp(score, 0, 100), 1);
}

function computeListing(fairValueXch: number, seed: string): ListingData {
  // Deterministic "ask price" somewhere in [0.85x, 1.15x] of fair value — sometimes a great deal,
  // sometimes overpriced, stable per-NFT.
  const multiplier = 0.85 + seededRandom(seed) * 0.3;
  const priceXch = round(fairValueXch * multiplier, 2);
  return { priceXch, priceUsd: round(priceXch * MOCK_XCH_USD_RATE, 2) };
}

function computeDealScore(fairValueXch: number, listingXch: number): DealScore {
  if (listingXch <= 0) return { score: 50, label: "FAIR DEAL" };
  const ratio = fairValueXch / listingXch; // >1 = listed below fair value = good for a buyer
  const score = clamp(Math.round(ratio * 70), 0, 100);
  const label =
    score >= 80 ? "GREAT DEAL" : score >= 60 ? "GOOD DEAL" : score >= 40 ? "FAIR DEAL" : "OVERPRICED";
  return { score, label };
}

// Call once on the full batch of NFTs for a collection page (or a single NFT wrapped in a
// 1-item array, for call sites that don't have batch context yet — trait rarityPercent will
// just be less precise in that case since frequency can't be computed across the real batch).
export function enrichNfts(nfts: NftData[], totalSupply: number): NftData[] {
  if (nfts.length === 0) return nfts;
  const percentByKey = computeTraitRarity(nfts);

  return nfts.map((nft) => {
    const traits = attachTraitRarity(nft.traits, percentByKey);
    const rarityScore = computeRarityScore(traits, nft.rarityRank, totalSupply);
    const fairValueXch = nft.fairValue?.totalEstimate ?? 0;
    const listing = fairValueXch > 0 ? computeListing(fairValueXch, nft.launcherId) : null;
    const dealScore = listing ? computeDealScore(fairValueXch, listing.priceXch) : null;

    return { ...nft, traits, rarityScore, listing, dealScore };
  });
}

// Per-trait tier tag (e.g. "EPIC 6.7%") — same tier vocabulary as the card-level rarity badge,
// just keyed off a trait's frequency instead of the NFT's overall rank.
export function tierIdForTrait(
  rarityPercent: number | undefined,
  thresholds?: RarityTierThresholds
): TierId | null {
  if (typeof rarityPercent !== "number") return null;
  return tierIdForPercentile(rarityPercent, thresholds);
}
