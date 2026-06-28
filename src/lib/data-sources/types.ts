import type { CollectionData, NftData } from "@/types";

// The seam between "mock" and "live" (ARCHITECTURE.md §7). MockDataSource implements this
// today; MintGardenDataSource implements the same interface later — callers never change.
//
// `collectionKey` is whatever the active adapter uses to identify a collection: the Misfitz
// slug for MockDataSource today, the on-chain/MintGarden collection id once a live adapter
// is registered (see Collection.chainCollectionId in ARCHITECTURE.md §3).
export interface DataSource {
  getCollection(collectionKey: string): Promise<CollectionData | null>;
  listNfts(collectionKey: string, page: number, pageSize?: number): Promise<NftData[]>;
  getNft(launcherId: string): Promise<NftData | null>;
  getNftsByOwner(address: string): Promise<NftData[]>;
}
