import type { DataSource } from "../types";
import type { CollectionData, NftData } from "@/types";
import { getCollection, getNftDetail, listCollectionNfts } from "./client";
import { mapCollection, mapDetailToNftData, mapListItemToNftData } from "./map";
import { fetchOwnerNftDetails } from "./owner";

// Live MintGarden adapter — the same DataSource seam MockDataSource implements (ARCHITECTURE.md
// §7). Collections flip to this by setting dataSourceKey: "mintgarden". `collectionKey` here is
// the on-chain collection id (col1...).
export class MintGardenDataSource implements DataSource {
  async getCollection(collectionKey: string): Promise<CollectionData | null> {
    try {
      return mapCollection(await getCollection(collectionKey));
    } catch {
      return null;
    }
  }

  // NOTE: MintGarden list endpoints are cursor-paginated, not page-numbered. For now we serve the
  // first page (page 0); deep collection browsing should migrate the DataSource interface to
  // cursors. The primary live path (getNftsByOwner) is unaffected.
  async listNfts(collectionKey: string, page: number, pageSize = 50): Promise<NftData[]> {
    if (page > 0) return [];
    try {
      const res = await listCollectionNfts(collectionKey, undefined, pageSize);
      return res.items.map((item) => mapListItemToNftData(item));
    } catch {
      return [];
    }
  }

  async getNft(launcherId: string): Promise<NftData | null> {
    try {
      return mapDetailToNftData(await getNftDetail(launcherId)).nft;
    } catch {
      return null;
    }
  }

  async getNftsByOwner(address: string): Promise<NftData[]> {
    const { details } = await fetchOwnerNftDetails(address);
    return details.map((d) => mapDetailToNftData(d).nft);
  }
}
