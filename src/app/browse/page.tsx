import { getTrendingCollections } from "@/lib/collections/discovery";
import { BrowseCollections } from "@/components/browse/BrowseCollections";
import type { Metadata } from "next";

// Browse — discover every NFT collection on Chia. Trending (by volume) up front, live search, and
// each tile opens the collection as a binder (same view as a wallet). "Vault Floor" header carries the
// landing's gold-vault language: eyebrow pill, a foil accent word, a thin gold hairline, faint texture.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse collections",
  description: "Discover every NFT collection on Chia — trending by volume, live search, rarity and estimated values. Tap any collection to open it as a binder.",
};

export default async function BrowsePage() {
  const trending = await getTrendingCollections(30);

  return (
    <div className="py-2">
      <div className="relative mb-4 px-2">
        <div className="tf-browse-tex" aria-hidden />
        <div className="relative">
          <span className="tf-eyebrow inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
            The Vault Floor · Every Chia collection
          </span>
          <h1 className="tf-browse-title text-title mt-2 text-2xl font-black tracking-tight sm:text-3xl">
            Browse <span className="tf-foil">Collections</span>
          </h1>
          <p className="tf-browse-sub text-subtle mt-1 max-w-2xl text-sm">
            Every NFT collection on Chia. Tap one to open it as a binder — sorted by rarity, with live values.
          </p>
        </div>
      </div>
      <BrowseCollections trending={trending} />
    </div>
  );
}
