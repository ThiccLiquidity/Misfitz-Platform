import { notFound } from "next/navigation";
import { getCollectionBySlug, listNftsForCollection } from "@/lib/db/queries";
import { CollectionHeader } from "@/components/collection/CollectionHeader";
import { CollectionStats } from "@/components/collection/CollectionStats";
import { BinderView } from "@/components/binder/BinderView";

// Generic route — works for any collection slug, no Misfitz-specific code here
// (ARCHITECTURE.md §4/§9). Run `npm run db:seed` first so this has data to read.
export default async function CollectionPage({ params }: { params: { slug: string } }) {
  const collection = await getCollectionBySlug(params.slug);
  if (!collection) notFound();

  // Fetched in full and paginated client-side by BinderView for milestone 1's scale (a few
  // dozen NFTs). A larger collection would swap this for server-side page fetches without
  // changing BinderView's props shape.
  const nfts = await listNftsForCollection(params.slug, 0, collection.nftCount);

  return (
    <div>
      <CollectionHeader collection={collection} />
      <CollectionStats nftCount={collection.nftCount} />
      <BinderView collection={collection} nfts={nfts} />
    </div>
  );
}
