import { prisma } from "./client";
import type { CollectionData, NftData, Trait } from "@/types";

// Server-side read layer. Pages/components call these, never Prisma directly and never a
// DataSource adapter — the database is the single source of truth at request time, regardless
// of whether the data behind it came from mock fixtures or a live sync job (ARCHITECTURE.md §7).

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
    orderBy: { launcherId: "asc" },
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
          estimatedAt: row.fairValueEstimate.estimatedAt.toISOString(),
        }
      : null,
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
          estimatedAt: row.fairValueEstimate.estimatedAt.toISOString(),
        }
      : null,
  };
}
