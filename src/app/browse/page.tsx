import { getTrendingCollections } from "@/lib/collections/discovery";
import { BrowseCollections } from "@/components/browse/BrowseCollections";
import type { Metadata } from "next";

// Browse — discover every NFT collection on Chia. Trending (by volume) up front, live search, and
// each tile opens the collection as a binder (same view as a wallet).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse collections",
  description: "Discover every NFT collection on Chia — trending by volume, live search, rarity and estimated values. Tap any collection to open it as a binder.",
};

export default async function BrowsePage() {
  const trending = await getTrendingCollections(30);

  return (
    <div className="py-2">
      <div className="mb-4 px-2">
        <h1 className="text-title text-2xl font-black">Browse Collections</h1>
        <p className="text-subtle mt-1 text-sm">
          Every NFT collection on Chia. Tap one to open it as a binder — sorted by rarity, with live values.
        </p>
      </div>
      <BrowseCollections trending={trending} />
    </div>
  );
}
