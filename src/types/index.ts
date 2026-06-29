// Shared domain types. Every component in /src/components takes only these — never a
// collection-specific shape. See ARCHITECTURE.md §3/§4.

import type { RarityTierThresholds } from "@/lib/rarity/tiers";

export interface Trait {
  trait_type: string;
  value: string | number;
  // % of the collection batch sharing this exact trait value (0-100, lower = rarer). Computed
  // by src/lib/rarity/enrich.ts from the currently-loaded batch — undefined until enriched.
  rarityPercent?: number;
}

export interface FairValueEstimate {
  floorValue: number;
  rarityPremium: number;
  // Reserved for dynamic trait demand/reputation (VALUATION.md). 0 until the sales feed exists.
  traitPremium: number;
  // Special/collectible-number bump (VALUATION.md Part 2). Optional so legacy/mock estimates that
  // predate it still type-check.
  desirabilityPremium?: number | null;
  historicalSalesPremium: number | null;
  demandPremium: number | null;
  rewardValue: number | null;
  totalEstimate: number;
  // Mock USD conversion of totalEstimate (src/lib/rarity/enrich.ts MOCK_XCH_USD_RATE) — swap for
  // a live price-feed lookup later without touching any component that reads this field.
  totalEstimateUsd: number;
  estimatedAt: string;
}

// Current marketplace ask for an NFT. Mock-derived for now (src/lib/rarity/enrich.ts) — will be
// replaced by a real listings sync without changing this shape.
export interface ListingData {
  priceXch: number;
  priceUsd: number;
}

// How the current listing compares to the fair value estimate — "is this a good buy". Derived,
// never hand-entered.
export interface DealScore {
  score: number; // 0-100
  label: string; // "GREAT DEAL" / "GOOD DEAL" / "FAIR DEAL" / "OVERPRICED"
}

export interface NftData {
  id: string;
  launcherId: string;
  collectionSlug: string;
  name: string;
  imageUrl: string;
  traits: Trait[];
  rarityRank: number | null;
  currentOwnerAddress: string | null;
  fairValue: FairValueEstimate | null;
  // Composite 0-100 score blending rank percentile and trait rarity — undefined until enriched
  // (src/lib/rarity/enrich.ts). Distinct from rank/percentile: two NFTs can share a rank
  // "neighborhood" but have very different trait-rarity makeups.
  rarityScore: number | null;
  listing: ListingData | null;
  dealScore: DealScore | null;
  // Special/collectible mint-number badge (VALUATION.md Part 2). Optional — only live-mapped NFTs
  // with a special number carry it. tier 1 = grail … 4 = fun.
  collectible?: { tier: number; label: string } | null;
}

export interface ThemeConfig {
  accent: string;
  logoUrl?: string;
}

export interface CollectionData {
  slug: string;
  name: string;
  description: string | null;
  bannerUrl: string | null;
  iconUrl: string | null;
  nftCount: number; // how many NFTs are currently loaded (may be a subset)
  totalSupply: number; // true series size — used for rarity percentile math, see src/lib/rarity
  rarityTiers?: Partial<RarityTierThresholds>; // collection's custom tier cutoffs, if any
  theme: ThemeConfig;
  /** On-chain collection id (col1...). Populated once the collection is minted and on Dexie.
   *  When non-null, the market layer fetches real floor/listing prices. Null → mock data. */
  dexieCollectionId: string | null;
}

export type ThemeMode = "dark" | "light";
