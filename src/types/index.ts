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
  // True when rarityRank was computed by our own OpenRarity estimator (src/lib/rarity/estimateRank)
  // because the indexer didn't supply one — UI marks these "≈". Exact (indexer) ranks omit it.
  rankEstimated?: boolean;
  currentOwnerAddress: string | null;
  fairValue: FairValueEstimate | null;
  // Composite 0-100 score blending rank percentile and trait rarity — undefined until enriched
  // (src/lib/rarity/enrich.ts). Distinct from rank/percentile: two NFTs can share a rank
  // "neighborhood" but have very different trait-rarity makeups.
  rarityScore: number | null;
  listing: ListingData | null;
  // Listing sourced from Dexie (the offer marketplace). listing.priceXch is the XCH-EQUIVALENT total
  // (Dexie folds in any CAT value). listingAssets/listingRequested describe what the buyer must give
  // (e.g. XCH + a CAT); dexieOfferId links to the offer page. Null when not listed on Dexie.
  listingAssets?: string[] | null;
  listingRequested?: { code: string; amount: number }[] | null;
  dexieOfferId?: string | null;
  // True when the price comes from MintGarden's listing but we could NOT read the full offer terms on
  // Dexie (so a hidden CAT can't be ruled out). Such listings show the price but never a deal score,
  // and never set the collection floor. Verify the real terms on MintGarden before buying.
  listingUnverified?: boolean | null;
  dealScore: DealScore | null;
  // Full SALE history in XCH (newest first, up to 20), straight from chain events — UNFILTERED by the comps
  // wash-defenses, so display-only, never fed into valuation. `date` is the ISO event time (null on stale cache).
  recentSales?: { priceXch: number; date?: string | null }[] | null;
  // Comparable-sales valuation (src/lib/valuation). When the comps model has evidence near this NFT,
  // fairValue.totalEstimate is blended toward the sales-implied value; these describe that influence.
  // valueConfidence 0..1 = how much real sales backed it; valueBasis = short human explanation.
  valueBasis?: string | null;
  valueConfidence?: number | null;
  valueSampleSize?: number | null; // # recent clean sales behind the comps model (for the UI hedge)
  // Sales-fitted market curve (src/lib/valuation/comps). valueCurve = the rank-fitted curve score
  // (floor+rarity+comps merged); valueTraitMult = trait amplifier applied on top. totalEstimate =
  // valueCurve × valueTraitMult + collector-number premium.
  valueCurve?: number | null;
  valueTraitMult?: number | null;
  // The single hottest trait driving the trait-demand bump (e.g. "Background:Gold"), for display only.
  valueTraitTop?: string | null;
  // Special/collectible mint-number badge (VALUATION.md Part 2). Optional — only live-mapped NFTs
  // with a special number carry it. tier 1 = grail … 4 = fun.
  collectible?: { tier: number; label: string } | null;
  // For mixed binders (Your Binder, across collections): the NFT's own collection size + display
  // name, so each card computes rarity against the right collection. Optional — single-collection
  // views pass these as props instead.
  totalSupply?: number;
  collectionName?: string;
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

export type ThemeMode = "dark" | "light" | "nostalgia" | "nostalgia-night"; // nostalgia = 90s desk (day); nostalgia-night = same desk, moonlit

// Lightweight collection card for the discovery / browse page (MintGarden trending + search).
export interface CollectionSummary {
  id: string; // col1...
  name: string;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  totalSupply: number;
  floorXch: number | null;
  volumeXch: number | null;
  tradeCount: number | null;
  creatorName: string | null;
  verified: boolean;
}
