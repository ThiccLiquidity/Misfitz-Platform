import { notFound } from "next/navigation";
import { getCollectionView } from "@/lib/collections/liveCollection";
import { CollectionBinder } from "@/components/collection/CollectionBinder";

// Live collection binder — the same binder experience as a wallet, but for a whole collection.
export const dynamic = "force-dynamic";

export default async function CollectionLivePage({ params }: { params: { id: string } }) {
  const view = await getCollectionView(params.id);
  if (!view) notFound();
  return <CollectionBinder key={view.id} view={view} />;
}
