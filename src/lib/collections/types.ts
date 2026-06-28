import type { ThemeConfig } from "@/types";

// Adding a collection means adding one of these plus a database row — see ARCHITECTURE.md §8/§9.
export interface CollectionPlugin {
  slug: string;
  name: string;
  description?: string;
  chainCollectionId: string | null; // null until the on-chain/MintGarden id is confirmed
  dataSourceKey: "mock" | "mintgarden";
  theme: ThemeConfig;
}
