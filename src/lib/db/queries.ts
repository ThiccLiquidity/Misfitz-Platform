import { prisma } from "./client";
import type { CollectionData, NftData, Trait } from "@/types";
import { MOCK_XCH_USD_RATE } from "@/lib/rarity/enrich";

// Server-side read layer. Pages/components call these, never Prisma directly and never a
// DataSource adapter — the database is the single source of truth at request time, regardless
// of whether the data behind it came from mock fixtures or a live sync job (ARCHITECTURE.md §7).
//
// rarityScore/listing/dealScore/trait.rarityPercent are left null/undefined here — they're
// derived from the *whole batch* of a collection's NFTs (trait frequency, etc.), not a single
// row, so callers that have the full batch (the collection page) run it through
// src/lib/rarity/enrich.ts's enrichNfts() afterward. Don't read those fields directly off this
// function's output before that enrichment step.

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Returns all collections in the DB, ordered alphabetically. Grabs the top-ranked NFT's
// imageUrl and stores it in bannerUrl (if the collection has no explicit bannerUrl set) so
// the Library shelf has something visual to show without a separate cover-art pipeline.
export async function listCollections(): Promise<CollectionData[]> {
  const rows = await prisma.collection.findMany({
    include: {
      _count: { select: { nfts: true } },
      nfts: {
        orderBy: { rarityRank: "asc" },
        take: 1,
        select: { imageUrl: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return rows.map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    bannerUrl: c.bannerUrl ?? c.nfts[0]?.imageUrl ?? null,
    iconUrl: c.iconUrl,
    nftCount: c._count.nfts,
    totalSupply: c.totalSupply,
    rarityTiers: c.tierConfig ? JSON.parse(c.tierConfig) : undefined,
    theme: JSON.parse(c.themeConfig),
  }));
}

export async function getCollectionBySlug(slug: string): Promise<CollectionData | null> {
  const collection = await prisma.collection.findUnique({
    where: { slug },
    include: { _count: { select: { nfts: true } } },
  });
  if (!collection) return null;

  return {
    slug: collection.slug,
    name: collection.name,
    description: collection.description,
    bannerUrl: collection.bannerUrl,
    iconUrl: collection.iconUrl,
    nftCount: collection._count.nfts,
    totalSupply: collection.totalSupply,
    rarityTiers: collection.tierConfig ? JSON.parse(collection.tierConfig) : undefined,
    theme: JSON.parse(collection.themeConfig),
  };
}

export async function listNftsForCollection(
  slug: string,
  page: number,
  pageSize = 9
): Promise<NftData[]> {
  const rows = await prisma.nft.findMany({
    where: { collection: { slug } },
    include: { fairValueEstimate: true },
    orderBy: { rarityRank: "asc" },
    skip: page * pageSize,
    take: pageSize,
  });

  return rows.map((row) => ({
    id: row.id,
    launcherId: row.launcherId,
    collectionSlug: slug,
    name: row.name,
    imageUrl: row.imageUrl,
    traits: JSON.parse(row.traits) as Trait[],
    rarityRank: row.rarityRank,
    currentOwnerAddress: row.currentOwnerAddress,
    fairValue: row.fairValueEstimate
      ? {
          floorValue: row.fairValueEstimate.floorValue,
          rarityPremium: row.fairValueEstimate.rarityPremium,
          traitPremium: row.fairValueEstimate.traitPremium,
          historicalSalesPremium: row.fairValueEstimate.historicalSalesPremium,
          demandPremium: row.fairValueEstimate.demandPremium,
          rewardValue: row.fairValueEstimate.rewardValue,
          totalEstimate: row.fairValueEstimate.totalEstimate,
          totalEstimateUsd: round(row.fairValueEstimate.totalEstimate * MOCK_XCH_USD_RATE),
          estimatedAt: row.fairValueEstimate.estimatedAt.toISOString(),
        }
      : null,
    rarityScore: null,
    listing: null,
    dealScore: null,
  }));
}

export async function getNftByLauncherId(launcherId: string): Promise<NftData | null> {
  const row = await prisma.nft.findUnique({
    where: { launcherId },
    include: { fairValueEstimate: true, collection: true },
  });
  if (!row) return null;

  return {
    id: row.id,
    launcherId: row.launcherId,
    collectionSlug: row.collection.slug,
    name: row.name,
    imageUrl: row.imageUrl,
    traits: JSON.parse(row.traits) as Trait[],
    rarityRank: row.rarityRank,
    currentOwnerAddress: row.currentOwnerAddress,
    fairValue: row.fairValueEstimate
      ? {
          floorValue: row.fairValueEstimate.floorValue,
          rarityPremium: row.fairValueEstimate.rarityPremium,
          traitPremium: row.fairValueEstimate.traitPremium,
          historicalSalesPremium: row.fairValueEstimate.historicalSalesPremium,
          demandPremium: row.fairValueEstimate.demandPremium,
          rewardValue: row.fairValueEstimate.rewardValue,
          totalEstimate: row.fairValueEstimate.totalEstimate,
          totalEstimateUsd: round(row.fairValueEstimate.totalEstimate * MOCK_XCH_USD_RATE),
          estimatedAt: row.fairValueEstimate.estimatedAt.toISOString(),
        }
      : null,
    rarityScore: null,
    listing: null,
    dealScore: null,
  };
}
