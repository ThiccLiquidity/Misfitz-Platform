import type { CollectionPlugin } from "./types";

// First supported collection. chainCollectionId is null because Misfitz has not been minted
// on-chain yet (confirmed with the collection owner — it's still pre-mint). Flip
// dataSourceKey to "mintgarden" and set chainCollectionId once it's actually live.
export const misfitz: CollectionPlugin = {
  slug: "misfitz",
  name: "Misfitz",
  description: "The first collection supported on the platform.",
  chainCollectionId: null,
  dataSourceKey: "mock",
  // Real series size from the CHIP-0007 metadata (series_total: 10000), even though we've only
  // imported the first 50 so far — rarity tiers need the true denominator to mean anything.
  totalSupply: 10000,
  theme: {
    accent: "#c9a227",
  },
};
