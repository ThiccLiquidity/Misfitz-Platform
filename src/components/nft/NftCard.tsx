import Image from "next/image";
import type { NftData } from "@/types";
import { RarityBadge } from "./RarityBadge";
import { getRarityTier, resolveTierThresholds, type RarityTierThresholds } from "@/lib/rarity/tiers";

interface NftCardProps {
  nft: NftData;
  onOpen: (launcherId: string) => void;
  totalSupply: number;
  rarityTiers?: Partial<RarityTierThresholds>;
}

// Trading-card proportions (5:7, approximating 2.5"x3.5" card stock) and layout validated via
// the interactive prototype — see ARCHITECTURE.md §11. Renders from plain NftData only, no
// collection-specific branching, so it works unmodified for any future collection.
//
// Border/glow/foil come from the rarity tier (src/lib/rarity/tiers.ts), computed from
// rarityRank + totalSupply (+ this collection's tier thresholds, if customized) — rare cards
// get the special treatment, common ones stay plain.
export function NftCard({ nft, onOpen, totalSupply, rarityTiers }: NftCardProps) {
  const tier = getRarityTier(nft.rarityRank, totalSupply, resolveTierThresholds(rarityTiers));

  return (
    <button
      type="button"
      onClick={() => onOpen(nft.launcherId)}
      className={`relative flex aspect-card flex-col overflow-hidden rounded-[9px] border-2 bg-card-bg p-1.5 text-left transition hover:-translate-y-0.5 ${tier.borderClass} ${tier.foil ? "rarity-foil" : ""} ${tier.premium ? "rarity-premium" : ""}`}
      style={{ boxShadow: tier.glow }}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[5px] bg-art-bg">
        <Image src={nft.imageUrl} alt={nft.name} fill className="object-contain p-3" sizes="200px" />
      </div>
      <div className="mt-1.5 truncate text-[11px] font-medium text-title">{nft.name}</div>
      <div className="flex items-center justify-between gap-1">
        <RarityBadge tier={tier} />
        {nft.fairValue && (
          <span className="text-subtle whitespace-nowrap text-[10px]">{nft.fairValue.totalEstimate.toFixed(2)} XCH</span>
        )}
      </div>
    </button>
  );
}
