import { notFound } from "next/navigation";
import { getCollectionView } from "@/lib/collections/liveCollection";
import { CollectionBinder } from "@/components/collection/CollectionBinder";
import { getCollection } from "@/lib/data-sources/mintgarden/client";
import type { Metadata } from "next";

// Live collection binder — the same binder experience as a wallet, but for a whole collection.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const col = await getCollection(params.id).catch(() => null); // TTL-cached; reused by the page render
  if (!col) return { title: "Collection" };
  const name = col.name ?? "Collection";
  const desc = `${name} on Chia — browse the collection by rarity, see each NFT's tier, floor, and estimated value on Traitfolio.`;
  return {
    title: name,
    description: desc,
    openGraph: { title: `${name} · Traitfolio`, description: desc, images: col.thumbnail_uri ? [{ url: col.thumbnail_uri }] : undefined },
    twitter: { card: "summary_large_image", title: `${name} · Traitfolio`, description: desc, images: col.thumbnail_uri ? [col.thumbnail_uri] : undefined },
  };
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default async function CollectionLivePage({ params }: { params: { id: string } }) {
  const view = await getCollectionView(params.id);
  if (!view) notFound();
  // JSON-LD structured data so search engines/social understand the collection page.
  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: view.name,
    ...(view.description ? { description: view.description } : {}),
    ...(view.imageUrl ? { image: view.imageUrl } : {}),
    url: `${SITE_URL}/collection/${view.id}`,
    isPartOf: { "@type": "WebSite", name: "Traitfolio", url: SITE_URL },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Browse", item: `${SITE_URL}/browse` },
        { "@type": "ListItem", position: 2, name: view.name, item: `${SITE_URL}/collection/${view.id}` },
      ],
    },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <CollectionBinder key={view.id} view={view} />
    </>
  );
}
