// Shared domain types. Every component in /src/components takes only these — never a
// collection-specific shape. See ARCHITECTURE.md §3/§4.

export interface Trait {
  trait_type: string;
  value: string | number;
}

export interface FairValueEstimate {
  floorValue: number;
  rarityPremium: number;
  traitPremium: number;
  historicalSalesPremium: number | null;
  demandPremium: number | null;
  rewardValue: number | null;
  totalEstimate: number;
  estimatedAt: string;
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
  nftCount: number;
  theme: ThemeConfig;
}

export type ThemeMode = "dark" | "light";
