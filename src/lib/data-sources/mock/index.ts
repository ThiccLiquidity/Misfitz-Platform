import type { DataSource } from "../types";
import type { CollectionData, NftData } from "@/types";
import { getCollectionPlugin } from "@/lib/collections/registry";
import misfitzFixture from "./fixtures/misfitz.json";

// Fixture files are shaped like a real NFT indexer response (MintGarden-style: launcherId,
// traits, rarityRank, currentOwnerAddress) so MintGardenDataSource will be a thin HTTP-calling
// implementation of the same DataSource interface later, not a redesign (ARCHITECTURE.md §7).
const FIXTURES: Record<string, typeof misfitzFixture> = {
  misfitz: misfitzFixture,
};

function toNftData(slug: string, raw: (typeof misfitzFixture)["nfts"][number]): NftData {
  return {
    id: raw.launcherId,
    launcherId: raw.launcherId,
    collectionSlug: slug,
    name: raw.name,
    imageUrl: raw.imageUrl,
    traits: raw.traits,
    rarityRank: raw.rarityRank,
    currentOwnerAddress: raw.currentOwnerAddress,
    fairValue: raw.fairValue
      ? { ...raw.fairValue, estimatedAt: new Date().toISOString() }
      : null,
  };
}

export class MockDataSource implements DataSource {
  async getCollection(collectionKey: string): Promise<CollectionData | null> {
    const fixture = FIXTURES[collectionKey];
    const plugin = getCollectionPlugin(collectionKey);
    if (!fixture || !plugin) return null;

    return {
      slug: plugin.slug,
      name: plugin.name,
      description: plugin.description ?? null,
      bannerUrl: null,
      iconUrl: null,
      nftCount: fixture.nftCount,
      theme: plugin.theme,
    };
  }

  async listNfts(collectionKey: string, page: number, pageSize = 9): Promise<NftData[]> {
    const fixture = FIXTURES[collectionKey];
    if (!fixture) return [];
    const start = page * pageSize;
    return fixture.nfts.slice(start, start + pageSize).map((nft) => toNftData(collectionKey, nft));
  }

  async getNft(launcherId: string): Promise<NftData | null> {
    for (const [slug, fixture] of Object.entries(FIXTURES)) {
      const match = fixture.nfts.find((nft) => nft.launcherId === launcherId);
      if (match) return toNftData(slug, match);
    }
    return null;
  }

  async getNftsByOwner(address: string): Promise<NftData[]> {
    const results: NftData[] = [];
    for (const [slug, fixture] of Object.entries(FIXTURES)) {
      for (const nft of fixture.nfts) {
        if (nft.currentOwnerAddress === address) results.push(toNftData(slug, nft));
      }
    }
    return results;
  }
}
