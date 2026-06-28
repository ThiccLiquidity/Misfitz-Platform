import type { CollectionPlugin } from "./types";

// First supported collection. chainCollectionId is null because the MintGarden lookup for
// "Misfitz" came back empty during research (see ARCHITECTURE.md §10) — confirm before
// flipping dataSourceKey to "mintgarden".
export const misfitz: CollectionPlugin = {
  slug: "misfitz",
  name: "Misfitz",
  description: "The first collection supported on the platform.",
  chainCollectionId: null,
  dataSourceKey: "mock",
  theme: {
    accent: "#c9a227",
  },
};
