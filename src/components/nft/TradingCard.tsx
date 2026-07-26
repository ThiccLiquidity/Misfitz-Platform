import Image from "next/image";
import { memo } from "react";
import type { NftData } from "@/types";
import { getRarityTier, resolveTierThresholds, type RarityTierThresholds } from "@/lib/rarity/tiers";
import { formatXchShort } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// TradingCard — the v2 card (see CARD-REDESIGN-PLAN.md).
//
// Deliberately a DROP-IN for NftRarityCard: identical props, so a call site swaps with one line.
// It is NOT wired into any live surface yet — NEXT_PUBLIC_NEW_CARD selects it, and it renders in
// /theme-lab regardless so the design can be reviewed without touching production.
//
// Structure (all styling reads from the six tier tokens in globals.css):
//   .card-frame.tier-{id}   pigment frame + emboss + refraction foil + cardstock grain
//     .card-in              inner card body (dark at night, paper in day)
//       .card-art           the HERO — fills all remaining height, art edge to edge
//         .card-rank        cream tilted rank sticker, like a grading label
//       .card-plate         collection (small, muted) / token (bold) / value
//
// What deliberately ISN'T here vs the legacy card: the stats panel, sparkles, gloss, tier banner
// and inline traits. Removing them is what gives the art its room; that information now lives in
// the detail modal. Owner decision, recorded in the plan.
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface TradingCardProps {
  nft: NftData;
  collectionName: string;
  totalSupply: number;
  rarityTiers?: Partial<RarityTierThresholds>;
  onOpen?: (launcherId: string) => void;
  variant?: "grid" | "detail";
  onArtClick?: () => void;
}

// "Misfitz #1204" -> "#1204"; a name with no trailing number is kept whole.
function tokenSuffix(name: string): string {
  const match = name.match(/#?(\d+)\s*$/);
  return match ? `#${match[1]}` : name;
}

function TradingCardImpl({
  nft,
  collectionName,
  totalSupply,
  rarityTiers,
  onOpen,
  variant = "grid",
  onArtClick,
}: TradingCardProps) {
  const thresholds = resolveTierThresholds(rarityTiers);
  const supply = nft.totalSupply ?? totalSupply;
  const colName = nft.collectionName ?? collectionName;
  const tier = getRarityTier(nft.rarityRank, supply, thresholds);
  const isDetail = variant === "detail";
  const token = tokenSuffix(nft.name);
  const value = nft.fairValue?.totalEstimate ?? null;

  return (
    <div
      className={`card-frame tier-${tier.id}${isDetail ? " card-detail" : ""}${onOpen ? " card-frame-clickable" : ""}`}
      onClick={onOpen ? () => onOpen(nft.launcherId) : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") onOpen(nft.launcherId); } : undefined}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `${colName} ${token}` : undefined}
    >
      <div className="card-in">
        <div
          className="card-art"
          onClick={onArtClick ? (e) => { e.stopPropagation(); onArtClick(); } : undefined}
          style={onArtClick ? { cursor: "zoom-in" } : undefined}
          role={onArtClick ? "button" : undefined}
          aria-label={onArtClick ? "View full image" : undefined}
        >
          {nft.imageUrl ? (
            <div className="card-art-img">
              {/* unoptimized, exactly as the legacy card: NFT art comes from arbitrary on-chain hosts
                  and the Next optimizer is switched off app-wide. */}
              <Image
                src={nft.imageUrl}
                alt={nft.name}
                fill
                className="object-contain"
                sizes={isDetail ? "380px" : "260px"}
                unoptimized
              />
            </div>
          ) : (
            <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.05)" }} aria-hidden />
          )}
          {tier.rank !== null && <div className="card-rank">#{tier.rank}</div>}
        </div>

        <div className="card-plate">
          <span className="card-nm">
            <span className="card-col" title={colName}>{colName}</span>
            <span className="card-tok" title={nft.name}>{token}</span>
          </span>
          {value !== null && <span className="card-val">{formatXchShort(value)}</span>}
        </div>
      </div>
    </div>
  );
}

export const TradingCard = memo(TradingCardImpl);
