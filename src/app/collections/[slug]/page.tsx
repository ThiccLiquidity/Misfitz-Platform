import { notFound } from "next/navigation";
import { getCollectionBySlug, listNftsForCollection, listCollections } from "@/lib/db/queries";
import { enrichNfts } from "@/lib/rarity/enrich";
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
  // Proper server-side pagination is the permanent fix (future task). 500 is plenty
  // for browsing/filtering while staying responsive.
  const DEV_CAP = 500;
  const rawNfts = await listNftsForCollection(params.slug, 0, DEV_CAP);
  const nfts = enrichNfts(rawNfts, collection.totalSupply);

  return (
    <div>
      <CollectionHeader collection={collection} />
      <TierStatsBar collection={collection} nfts={nfts} />
      <CollectionBrowser collection={collection} nfts={nfts} allCollections={allCollections} />
    </div>
  );
}
