import type { NftData } from "@/types";
import type { RarityTierThresholds } from "@/lib/rarity/tiers";
import { NftRarityCard } from "@/components/nft/NftRarityCard";

interface BinderPageProps {
  nfts: NftData[];
  collectionName: string;
  onOpen: (launcherId: string) => void;
  totalSupply: number;
  rarityTiers?: Partial<RarityTierThresholds>;
  // "left" | "right" applies matching corner radii to blend with the spread layout.
  // Omit for standalone single-page use (all corners rounded).
  side?: "left" | "right";
}

// 3×3 grid — 9 portrait cards per page, matching the physical binder reference.
// Stats/traits/footer are hidden at this scale — all details visible in the detail modal.
export function BinderPage({
  nfts,
  collectionName,
  onOpen,
  totalSupply,
  rarityTiers,
  side,
}: BinderPageProps) {
  const radius =
    side === "left"  ? "rounded-l-xl" :
    side === "right" ? "rounded-r-xl" :
                       "rounded-xl";

  return (
    <div className={`tcg-binder-page grid grid-cols-3 grid-rows-3 gap-1.5 ${radius} p-2 h-full w-full`}>
      {nfts.map((nft) => (
        <div key={nft.launcherId} className="tcg-sleeve min-h-0">
          <NftRarityCard
            nft={nft}
            collectionName={collectionName}
            onOpen={onOpen}
            totalSupply={totalSupply}
            rarityTiers={rarityTiers}
          />
        </div>
      ))}
    </div>
  );
}
