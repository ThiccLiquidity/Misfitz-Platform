import Image from "next/image";
import type { NftData } from "@/types";
import { RarityBadge } from "./RarityBadge";

interface NftCardProps {
  nft: NftData;
  onOpen: (launcherId: string) => void;
}

// Trading-card proportions (5:7, approximating 2.5"x3.5" card stock) and layout validated via
// the interactive prototype — see ARCHITECTURE.md §11. Renders from plain NftData only, no
// collection-specific branching, so it works unmodified for any future collection.
export function NftCard({ nft, onOpen }: NftCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(nft.launcherId)}
      className="flex aspect-card flex-col rounded-[9px] border-2 border-card-border bg-card-bg p-1.5 text-left shadow-[var(--card-glow)] transition hover:-translate-y-0.5"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[5px] bg-art-bg">
        <Image src={nft.imageUrl} alt={nft.name} fill className="object-contain p-3" sizes="200px" />
      </div>
      <div className="mt-1.5 truncate text-[11px] font-medium text-title">{nft.name}</div>
      <div className="flex items-center justify-between">
        <RarityBadge rank={nft.rarityRank} />
        {nft.fairValue && (
          <span className="text-subtle text-[10px]">{nft.fairValue.totalEstimate.toFixed(2)} XCH</span>
        )}
      </div>
    </button>
  );
}
