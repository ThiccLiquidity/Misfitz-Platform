import type { ThemeConfig } from "@/types";
import type { RarityTierThresholds } from "@/lib/rarity/tiers";

// Adding a collection means adding one of these plus a database row — see ARCHITECTURE.md §8/§9.
export interface CollectionPlugin {
  slug: string;
  name: string;
  description?: string;
  chainCollectionId: string | null; // null until the on-chain/MintGarden id is confirmed
  dataSourceKey: "mock" | "mintgarden";
  theme: ThemeConfig;
  // True series size (e.g. 10000 for Misfitz), used to turn an NFT's absolute rarityRank into a
  // percentile for rarity-tier styling (src/lib/rarity) — stays fixed even while only a subset
  // of the collection has been imported.
  totalSupply: number;
  // Optional per-collection override of rarity tier cutoffs (src/lib/rarity/tiers.ts). Omit to
  // use the platform defaults. Only the percentages are customizable here — tier visuals
  // (border/glow/foil) are fixed platform-wide.
  rarityTiers?: Partial<RarityTierThresholds>;
}
