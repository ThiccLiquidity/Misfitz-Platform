// Loads mock fixture data into the dev database via the registered collection plugins.
// Run with `npm run db:seed`. The rest of the app only ever reads from the database
// (ARCHITECTURE.md §7) — this script is the one place that knows about DataSource adapters.

import { PrismaClient } from "@prisma/client";
import { collectionRegistry } from "../src/lib/collections/registry";
import { MockDataSource } from "../src/lib/data-sources/mock";
import type { DataSource } from "../src/lib/data-sources/types";

const prisma = new PrismaClient();

const adapters: Record<string, DataSource> = {
  mock: new MockDataSource(),
  // mintgarden: new MintGardenDataSource(),  -- registered once live integration begins
};

async function main() {
  for (const plugin of collectionRegistry) {
    const adapter = adapters[plugin.dataSourceKey];
    if (!adapter) {
      console.warn(`No adapter registered for dataSourceKey "${plugin.dataSourceKey}", skipping ${plugin.slug}`);
      continue;
    }

    const collectionData = await adapter.getCollection(plugin.slug);
    if (!collectionData) {
      console.warn(`Adapter returned no data for collection "${plugin.slug}", skipping`);
      continue;
    }

    const collection = await prisma.collection.upsert({
      where: { slug: plugin.slug },
      update: {
        name: collectionData.name,
        description: collectionData.description,
        bannerUrl: collectionData.bannerUrl,
        iconUrl: collectionData.iconUrl,
        chainCollectionId: plugin.chainCollectionId,
        dataSourceKey: plugin.dataSourceKey,
        themeConfig: JSON.stringify(plugin.theme),
      },
      create: {
        slug: plugin.slug,
        name: collectionData.name,
        description: collectionData.description,
        bannerUrl: collectionData.bannerUrl,
        iconUrl: collectionData.iconUrl,
        chainCollectionId: plugin.chainCollectionId,
        dataSourceKey: plugin.dataSourceKey,
        themeConfig: JSON.stringify(plugin.theme),
      },
    });

    // Pull every NFT page-by-page from the adapter until it runs dry.
    let page = 0;
    let total = 0;
    while (true) {
      const nfts = await adapter.listNfts(plugin.slug, page, 50);
      if (nfts.length === 0) break;

      for (const nft of nfts) {
        const row = await prisma.nft.upsert({
          where: { launcherId: nft.launcherId },
          update: {
            collectionId: collection.id,
            name: nft.name,
            imageUrl: nft.imageUrl,
            metadata: JSON.stringify({}),
            traits: JSON.stringify(nft.traits),
            rarityRank: nft.rarityRank,
            currentOwnerAddress: nft.currentOwnerAddress,
            lastSyncedAt: new Date(),
          },
          create: {
            launcherId: nft.launcherId,
            collectionId: collection.id,
            name: nft.name,
            imageUrl: nft.imageUrl,
            metadata: JSON.stringify({}),
            traits: JSON.stringify(nft.traits),
            rarityRank: nft.rarityRank,
            currentOwnerAddress: nft.currentOwnerAddress,
            lastSyncedAt: new Date(),
          },
        });

        if (nft.fairValue) {
          await prisma.fairValueEstimate.upsert({
            where: { nftId: row.id },
            update: { ...nft.fairValue, estimatedAt: new Date() },
            create: { ...nft.fairValue, estimatedAt: new Date(), nftId: row.id },
          });
        }
      }

      total += nfts.length;
      page += 1;
    }

    await prisma.syncLog.create({
      data: {
        collectionId: collection.id,
        source: plugin.dataSourceKey,
        finishedAt: new Date(),
        status: "success",
      },
    });

    console.log(`Seeded ${total} NFTs for collection "${plugin.slug}"`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
