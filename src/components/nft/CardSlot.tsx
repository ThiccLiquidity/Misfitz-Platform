"use client";

import type { NftData } from "@/types";
import type { RarityTierThresholds } from "@/lib/rarity/tiers";
import { NEW_CARD_ENABLED } from "@/lib/cardFlag";
import { NftRarityCard } from "./NftRarityCard";
import { TradingCard } from "./TradingCard";

// One pocket in a binder: the sleeve plus whichever card implementation is active.
//
// This exists so the legacy/v2 choice lives in EXACTLY ONE place during the migration
// (CARD-REDESIGN-PLAN.md). Both binder surfaces render a sleeve wrapping a card, so without this
// the flag check would be duplicated at every call site and the eventual deletion would be a hunt.
// When the v2 card ships for good, this collapses to the TradingCard branch and NftRarityCard goes.
export function CardSlot({
  nft,
  collectionName,
  totalSupply,
  rarityTiers,
  onOpen,
  fill = false,
  className = "",
}: {
  nft: NftData;
  collectionName: string;
  totalSupply: number;
  rarityTiers?: Partial<RarityTierThresholds>;
  onOpen?: (launcherId: string) => void;
  // true in the desktop page spread, where the grid row dictates height rather than the 5:7 ratio.
  fill?: boolean;
  className?: string;
}) {
  const sleeve = NEW_CARD_ENABLED
    ? `card-sleeve${fill ? " card-sleeve-fill" : ""}`
    : "tcg-sleeve";

  return (
    <div className={`${sleeve}${className ? ` ${className}` : ""}`}>
      {NEW_CARD_ENABLED ? (
        <TradingCard
          nft={nft}
          collectionName={collectionName}
          totalSupply={totalSupply}
          rarityTiers={rarityTiers}
          onOpen={onOpen}
        />
      ) : (
        <NftRarityCard
          nft={nft}
          collectionName={collectionName}
          totalSupply={totalSupply}
          rarityTiers={rarityTiers}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
