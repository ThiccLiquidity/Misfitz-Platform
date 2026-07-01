// Derived/computed NFT fields — trait rarity %, composite rarity score, listing price, and
// deal score. None of this is raw chain data, so none of it lives in the database; it's computed
// once per request from whatever batch of NftData a DataSource/Prisma query already returned
// (ARCHITECTURE.md §7 — DB/fixtures stay "raw", presentation-layer math stays here). That keeps
// this collection-agnostic: it only ever reads the generic NftData/Trait shape, never anything
// Misfitz-specific, so it works unmodified for any future collection.
//
// Market data (XCH rate, floor, per-NFT listing) is accepted as an optional MarketContext so
// real Dexie prices can be threaded in from the page layer without changing this file's callers.
// When MarketContext is absent or its fields are null, falls back to deterministic mock values
// so the UI never breaks while a collection is pre-mint or offline.

import type { DealScore, ListingData, NftData, Trait } from "@/types";
import { tierIdForPercentile, type RarityTierThresholds, type TierId } from "./tiers";
import type { MarketContext } from "@/lib/market/dexie";
import { XCH_USD_FALLBACK } from "@/lib/market/constants";

// Re-exported so queries.ts (and any other pre-enrichment caller) can use the same constant
// for initial USD estimates without importing from the market layer directly.
export const MOCK_XCH_USD_RATE = XCH_USD_FALLBACK;

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
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return ((h >>> 0) % 10000) / 10000;
}

// What fraction of the batch shares each exact trait_type/value pair — real math on whatever
// NFTs are currently loaded, not invented data.
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

function mockListing(fairValueXch: number, seed: string): ListingData {
  // Deterministic ask price in [0.85x, 1.15x] of fair value — stable per-NFT.
  const multiplier = 0.85 + seededRandom(seed) * 0.3;
  const priceXch = round(fairValueXch * multiplier, 2);
  return { priceXch, priceUsd: round(priceXch * MOCK_XCH_USD_RATE, 2) };
}

export function computeDealScore(fairValueXch: number, listingXch: number): DealScore {
  if (listingXch <= 0 || fairValueXch <= 0) return { score: 50, label: "FAIR DEAL" };
  // Centered on fair value: discount = how far the ask sits below our estimate (0 = at fair value).
  // Paying exactly fair value scores 50 (FAIR); a real discount is needed for GREAT, and an ask above
  // fair value drops below 50 toward OVERPRICED.
  const discount = 1 - listingXch / fairValueXch; // >0 = below fair (good), <0 = above fair
  const score = clamp(Math.round(50 + discount * 120), 0, 100);
  const label =
    score >= 80 ? "GREAT DEAL" : score >= 60 ? "GOOD DEAL" : score >= 40 ? "FAIR DEAL" : "OVERPRICED";
  return { score, label };
}

/**
 * Enriches a batch of NFTs with computed fields.
 *
 * @param nfts         Raw NFTs from the DB (same collection, same batch)
 * @param totalSupply  True series size — used for rarity percentile math
 * @param market       Optional live market data from Dexie. When provided:
 *                       • xchUsdRate → replaces the hardcoded fallback for all USD fields
 *                       • floorXch   → replaces the DB-stored floorValue in fairValue estimates
 *                     Falls back to deterministic mock values when absent or null.
 */
export function enrichNfts(
  nfts: NftData[],
  totalSupply: number,
  market?: MarketContext,
): NftData[] {
  if (nfts.length === 0) return nfts;

  const xchUsdRate = market?.xchUsdRate ?? MOCK_XCH_USD_RATE;
  const percentByKey = computeTraitRarity(nfts);

  return nfts.map((nft) => {
    const traits = attachTraitRarity(nft.traits, percentByKey);
    const rarityScore = computeRarityScore(traits, nft.rarityRank, totalSupply);

    // ── Fair value ──────────────────────────────────────────────────────────
    let fairValue = nft.fairValue;
    if (fairValue) {
      // If a real floor price is available, use it instead of the DB-stored floor.
      // Premiums (rarity, traits, etc.) are still DB-sourced until we have real sales data.
      const floorValue = market?.floorXch ?? fairValue.floorValue;
      const totalEstimate = round(
        floorValue +
          (fairValue.rarityPremium ?? 0) +
          (fairValue.traitPremium ?? 0) +
          (fairValue.historicalSalesPremium ?? 0) +
          (fairValue.demandPremium ?? 0) +
          (fairValue.rewardValue ?? 0),
        2,
      );
      fairValue = {
        ...fairValue,
        floorValue,
        totalEstimate,
        totalEstimateUsd: round(totalEstimate * xchUsdRate, 2),
      };
    }

    const fairValueXch = fairValue?.totalEstimate ?? 0;

    // ── Listing ─────────────────────────────────────────────────────────────
    // Real listing is injected at the detail-page level (fetchNftListing).
    // At binder level we use a deterministic mock so every card has a price.
    const listing =
      fairValueXch > 0 ? mockListing(fairValueXch, nft.launcherId) : null;

    const dealScore = listing ? computeDealScore(fairValueXch, listing.priceXch) : null;

    return { ...nft, traits, rarityScore, fairValue, listing, dealScore };
  });
}

// Per-trait tier tag — same tier vocabulary as the card-level rarity badge.
export function tierIdForTrait(
  rarityPercent: number | undefined,
  thresholds?: RarityTierThresholds,
): TierId | null {
  if (typeof rarityPercent !== "number") return null;
  return tierIdForPercentile(rarityPercent, thresholds);
}
