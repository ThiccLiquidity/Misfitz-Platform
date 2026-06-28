"use client";

import Image from "next/image";
import type { NftData } from "@/types";
import { RarityBadge } from "./RarityBadge";
import { TraitsList } from "./TraitsList";
import { FairValueBreakdown } from "./FairValueBreakdown";
import { OwnershipPanel } from "./OwnershipPanel";

interface NftDetailModalProps {
  nft: NftData;
  onClose: () => void;
}

// Center-front, background-blurred card open — validated via the prototype (ARCHITECTURE.md §11).
// The blur is applied by the parent (BinderView) to the binder behind this overlay.
export function NftDetailModal({ nft, onClose }: NftDetailModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={nft.name}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl gap-5 overflow-y-auto rounded-2xl border-2 border-card-border bg-card-bg p-5 shadow-[var(--card-glow)]"
      >
        <div className="relative aspect-card w-48 flex-shrink-0 overflow-hidden rounded-xl bg-art-bg">
          <Image src={nft.imageUrl} alt={nft.name} fill className="object-contain p-6" sizes="200px" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-title text-lg font-semibold">{nft.name}</h2>
              <RarityBadge rank={nft.rarityRank} />
            </div>
            <button
              onClick={onClose}
              type="button"
              aria-label="Close"
              className="text-subtle rounded-full px-2 py-1 text-sm hover:opacity-70"
            >
              ✕
            </button>
          </div>

          <TraitsList traits={nft.traits} />
          {nft.fairValue && <FairValueBreakdown estimate={nft.fairValue} />}
          <OwnershipPanel ownerAddress={nft.currentOwnerAddress} />
        </div>
      </div>
    </div>
  );
}
