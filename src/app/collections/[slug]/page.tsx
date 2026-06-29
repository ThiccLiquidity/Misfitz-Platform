import { notFound } from "next/navigation";
import { getCollectionBySlug, listNftsForCollection, listCollections } from "@/lib/db/queries";
import { enrichNfts } from "@/lib/rarity/enrich";
import { fetchMarketContext } from "@/lib/market/dexie";
import { CollectionHeader } from "@/components/collection/CollectionHeader";
import { CollectionBrowser } from "@/components/collection/CollectionBrowser";
import { TierStatsBar } from "@/components/collection/TierStatsBar";

// Generic route — works for any collection slug, no Misfitz-specific code here
// (ARCHITECTURE.md §4/§9). Run `npm run db:seed` first so this has data to read.
export default async function CollectionPage({ params }: { params: { slug: string } }) {
  const [collection, allCollections] = await Promise.all([
    getCollectionBySlug(params.slug),
    listCollections(),
  ]);
  if (!collection) notFound();

  // DEV CAP: loading all 10k NFTs on every request kills performance in dev mode.
  const DEV_CAP = 500;

  // Fetch NFTs and market data in parallel — market fetch is TTL-cached so it's cheap
  const [rawNfts, market] = await Promise.all([
    listNftsForCollection(params.slug, 0, DEV_CAP),
    fetchMarketContext(collection.dexieCollectionId),
  ]);

  // market.floorXch is real if collection.dexieCollectionId is set + Dexie has listings;
  // falls back to mock floor/mocked listing prices otherwise — UI never breaks either way.
  const nfts = enrichNfts(rawNfts, collection.totalSupply, market);

  return (
    <div>
      <CollectionHeader collection={collection} />
      <TierStatsBar collection={collection} nfts={nfts} />
      <CollectionBrowser collection={collection} nfts={nfts} allCollections={allCollections} />
    </div>
  );
}
