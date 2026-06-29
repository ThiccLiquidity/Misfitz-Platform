import Image from "next/image";
import type { NftData } from "@/types";
import {
  getRarityTier,
  resolveTierThresholds,
  tierIdForPercentile,
  getTierVisual,
  type RarityTierThresholds,
  type TierId,
} from "@/lib/rarity/tiers";
import { formatUsd, formatXch, truncateAddress } from "@/lib/format";
import { DealScoreGauge, colorForLabel } from "./DealScoreGauge";
import type React from "react";

// ─────────────────────────────────────────────────────────────
// Sparkle element configs — rendered inside .tcg-panel only.
// Art zone is ALWAYS zero overlays regardless of tier.
// Colors: mythic = rainbow per sparkle; epic = bright white.
// ─────────────────────────────────────────────────────────────
const SPARKLE_CONFIGS: Partial<Record<TierId, React.CSSProperties[]>> = {
  mythic: [
    { left: "8%",  top: "20%", color: "#ff60cc", animationName: "sp-a", animationDuration: "2.8s", animationDelay: "0s",   animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "72%", top: "18%", color: "#60ccff", animationName: "sp-b", animationDuration: "3.1s", animationDelay: ".7s",  animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "42%", top: "55%", color: "#ffee44", animationName: "sp-c", animationDuration: "2.6s", animationDelay: "1.4s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "85%", top: "60%", color: "#88ff88", animationName: "sp-d", animationDuration: "3.3s", animationDelay: ".3s",  animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "18%", top: "72%", color: "#cc66ff", animationName: "sp-e", animationDuration: "2.9s", animationDelay: "1.1s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "60%", top: "38%", color: "#ff8844", animationName: "sp-f", animationDuration: "3.0s", animationDelay: ".5s",  animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
  ],
  epic: [
    { left: "6%",  top: "15%", color: "rgba(255,255,255,.9)", animationName: "sp-a", animationDuration: "3.0s",  animationDelay: "0s",   animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "80%", top: "12%", color: "rgba(255,255,255,.9)", animationName: "sp-b", animationDuration: "2.8s",  animationDelay: ".9s",  animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "50%", top: "48%", color: "rgba(255,255,255,.9)", animationName: "sp-c", animationDuration: "3.2s",  animationDelay: "1.7s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "88%", top: "65%", color: "rgba(255,255,255,.9)", animationName: "sp-d", animationDuration: "2.7s",  animationDelay: ".4s",  animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "22%", top: "78%", color: "rgba(255,255,255,.9)", animationName: "sp-e", animationDuration: "3.1s",  animationDelay: "1.3s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "64%", top: "30%", color: "rgba(255,255,255,.9)", animationName: "sp-f", animationDuration: "2.9s",  animationDelay: ".6s",  animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "35%", top: "22%", color: "rgba(220,235,255,.8)", animationName: "sp-a", animationDuration: "3.4s",  animationDelay: "2.0s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
    { left: "14%", top: "45%", color: "rgba(220,235,255,.8)", animationName: "sp-d", animationDuration: "3.0s",  animationDelay: "1.0s", animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" },
  ],
};

// Tiers that get a panel gloss overlay
const HAS_GLOSS = new Set<TierId>(["mythic", "legendary", "epic"]);

interface NftRarityCardProps {
  nft: NftData;
  collectionName: string;
  totalSupply: number;
  rarityTiers?: Partial<RarityTierThresholds>;
  onOpen?: (launcherId: string) => void;
  // "grid" = compact binder cell; "detail" = larger zoomed view (same layout, bigger art + text)
  variant?: "grid" | "detail";
}

// Full TCG-style rarity card with full-bleed art and per-tier spinning border.
//
// Architecture:
//   .tcg-outer-{tier}   — animated conic-gradient border wrapper (padding trick)
//     .tcg-card-body    — overflow:hidden inner card
//       .tcg-art-zone   — full-bleed art, ZERO overlays ever
//         .tcg-art-bg   — dark radial bg (tier-specific)
//         .tcg-nft-art  — Next.js Image, object-contain, fills zone
//         .tcg-art-hdr  — floating header (collection name + rank tag), fades fast
//       .tcg-panel      — frosted glass; ALL chrome effects live here
//         .tcg-gloss    — diagonal gloss (mythic/legendary/epic only)
//         .tcg-sp       — sparkle crosses (mythic + epic only)
//         .tcg-panel-content — stats, traits, footer, banner (z-index above effects)
export function NftRarityCard({
  nft,
  collectionName,
  totalSupply,
  rarityTiers,
  onOpen,
  variant = "grid",
}: NftRarityCardProps) {
  const thresholds = resolveTierThresholds(rarityTiers);
  const supply = nft.totalSupply ?? totalSupply;
  const colName = nft.collectionName ?? collectionName;
  const tier = getRarityTier(nft.rarityRank, supply, thresholds);
  const isDetail = variant === "detail";
  const id = tier.id;
  const sparkles = SPARKLE_CONFIGS[id] ?? [];

  // Keep cards a consistent shape regardless of how many traits an NFT has. Sort rarest-first
  // (when trait rarity is known) so the most interesting traits survive the cap. Compact grid
  // cells show up to GRID_TRAIT_CAP with a "+N more" chip; the detail view shows all but inside a
  // bounded, scrollable box (.tcg-trait-grid-scroll) so it never elongates off the card.
  const GRID_TRAIT_CAP = 6;
  const sortedTraits = [...nft.traits].sort((a, b) => {
    const ra = typeof a.rarityPercent === "number" ? a.rarityPercent : 999;
    const rb = typeof b.rarityPercent === "number" ? b.rarityPercent : 999;
    return ra - rb;
  });
  const shownTraits = isDetail ? sortedTraits : sortedTraits.slice(0, GRID_TRAIT_CAP);
  const hiddenTraitCount = nft.traits.length - shownTraits.length;

  const lbl = isDetail ? "text-xs"     : "text-[7px]";
  const val = isDetail ? "text-sm"     : "text-[9px]";
  const sub = isDetail ? "text-xs"     : "";

  // Tier banner suffix: "#1 OF 50" for top-1%-or-rarer, otherwise "TOP X%"
  const bannerSuffix =
    tier.percentile !== null && tier.percentile < 1 && tier.rank !== null
      ? "#" + tier.rank + " OF " + String(supply)
      : tier.percentileLabel.toUpperCase();

  return (
    <div
      className={`tcg-outer tcg-outer-${id}${onOpen ? " tcg-outer-clickable" : ""}`}
      onClick={onOpen ? () => onOpen(nft.launcherId) : undefined}
      onKeyDown={
        onOpen
          ? (e) => { if (e.key === "Enter" || e.key === " ") onOpen(nft.launcherId); }
          : undefined
      }
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className={`tcg-card-body tcg-body-${id}`}>

        {/* ── CARD HEADER — name + rank on card body material, NOT inside art zone ── */}
        <div className={`tcg-card-header tcg-ch-${id}`}>
          <span className="tcg-cname">
            {colName} | {tokenSuffix(nft.name)}
          </span>
          {tier.rank !== null && (
            <div className={`tcg-rank-tag tcg-rank-tag-${id}`}>
              <span className="tcg-rank-lbl">Rank</span>
              <span className="tcg-rank-num">#{tier.rank}</span>
            </div>
          )}
        </div>

        {/* ── ART ZONE — truly zero overlays, clean art as minted ── */}
        <div className={`tcg-art-zone${isDetail ? " tcg-art-zone-detail" : ""}`}>
          <div className={`tcg-art-bg tcg-art-bg-${id}`} />
          <div className="tcg-nft-art">
            <Image
              src={nft.imageUrl}
              alt={nft.name}
              fill
              className="object-contain"
              sizes={isDetail ? "380px" : "260px"}
            />
          </div>
          {isDetail && (
            <div className="tcg-art-clean-label">Art as minted</div>
          )}
        </div>

        {/* ── PANEL — all effects scoped here ── */}
        <div className={`tcg-panel tcg-panel-${id}`}>
          {/* Gloss (mythic, legendary, epic — panel only) */}
          {HAS_GLOSS.has(id) && <div className={`tcg-gloss tcg-gloss-${id}`} />}

          {/* Sparkles (mythic + epic — panel only) */}
          {sparkles.map((style, i) => (
            <div key={i} className="tcg-sp" style={style} />
          ))}

          {/* Content sits above gloss + sparkle layer */}
          <div className="tcg-panel-content">

            {!isDetail && (
            <div className={`tcg-stats tcg-stats-${id}`}>
              <StatBlock
                label="Est. Value"
                primary={nft.fairValue ? formatXch(nft.fairValue.totalEstimate) : "—"}
                secondary={nft.fairValue ? formatUsd(nft.fairValue.totalEstimateUsd) : undefined}
                lblClass={`tcg-stat-lbl tcg-lbl-${id} ${lbl}`}
                valClass={`tcg-stat-val ${val}`}
                subClass={`tcg-stat-sub tcg-sub-${id} ${sub}`}
              />
              <StatBlock
                label="Listing"
                primary={nft.listing ? formatXch(nft.listing.priceXch) : "—"}
                secondary={nft.listing ? formatUsd(nft.listing.priceUsd) : undefined}
                lblClass={`tcg-stat-lbl tcg-lbl-${id} ${lbl}`}
                valClass={`tcg-stat-val ${val}`}
                subClass={`tcg-stat-sub tcg-sub-${id} ${sub}`}
              />
              <div className="tcg-stat">
                <span className={`tcg-stat-lbl tcg-lbl-${id} ${lbl}`}>Deal Score</span>
                {nft.dealScore ? (
                  <>
                    <DealScoreGauge score={nft.dealScore.score} label={nft.dealScore.label} />
                    <span
                      className={`tcg-stat-sub font-bold ${lbl}`}
                      style={{ color: colorForLabel(nft.dealScore.label) }}
                    >
                      {nft.dealScore.label}
                    </span>
                  </>
                ) : (
                  <span className={`tcg-stat-val ${val}`}>—</span>
                )}
              </div>
            </div>
            )}

            {/* Traits */}
            {nft.traits.length > 0 && (
              <>
                <div className="tcg-traits-header">
                  <span className={`tcg-traits-pill tcg-traits-pill-${id}`}>
                    Traits · {nft.traits.length}
                  </span>
                </div>
                <div
                  className={`tcg-trait-grid tcg-trait-grid-${id}${isDetail ? " tcg-trait-grid-scroll" : ""}`}
                >
                  {shownTraits.map((trait) => (
                    <TraitRow
                      key={trait.trait_type}
                      trait={trait}
                      thresholds={thresholds}
                      tierId={id}
                      lblClass={lbl}
                    />
                  ))}
                  {hiddenTraitCount > 0 && (
                    <div className={`tcg-trait-more tcg-trait-row-${id}`}>
                      +{hiddenTraitCount} more {hiddenTraitCount === 1 ? "trait" : "traits"}
                    </div>
                  )}
                </div>
              </>
            )}

            {!isDetail && (
            <div className={`tcg-footer-row tcg-footer-${id}`}>
              <StatBlock
                label="Rarity Score"
                primary={nft.rarityScore !== null ? nft.rarityScore.toFixed(1) : "—"}
                secondary={tier.percentile !== null ? tier.percentileLabel : undefined}
                lblClass={`tcg-stat-lbl tcg-lbl-${id} ${lbl}`}
                valClass={`tcg-stat-val ${val}`}
                subClass={`tcg-stat-sub tcg-sub-${id} ${sub}`}
              />
              <StatBlock
                label="Percentile"
                primary={
                  tier.percentile !== null
                    ? `${(100 - tier.percentile).toFixed(1)}%`
                    : "—"
                }
                secondary={tier.percentile !== null ? tier.percentileLabel : undefined}
                lblClass={`tcg-stat-lbl tcg-lbl-${id} ${lbl}`}
                valClass={`tcg-stat-val ${val}`}
                subClass={`tcg-stat-sub tcg-sub-${id} ${sub}`}
              />
              <StatBlock
                label="Owned By"
                primary={
                  nft.currentOwnerAddress
                    ? truncateAddress(nft.currentOwnerAddress, 4, 4)
                    : "Unknown"
                }
                secondary={nft.currentOwnerAddress ? "Not yours" : undefined}
                lblClass={`tcg-stat-lbl tcg-lbl-${id} ${lbl}`}
                valClass={`tcg-stat-val ${val}`}
                subClass={`tcg-stat-sub tcg-sub-${id} ${sub}`}
              />
            </div>
            )}

            {/* Tier banner */}
            <div className={`tcg-tier-banner tcg-tier-banner-${id}`}>
              {tier.symbol} {tier.label.toUpperCase()} {"—"} {bannerSuffix}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenSuffix(name: string): string {
  const match = name.match(/#?(\d+)\s*$/);
  return match ? `#${match[1]}` : name;
}

function StatBlock({
  label,
  primary,
  secondary,
  lblClass,
  valClass,
  subClass,
}: {
  label: string;
  primary: string;
  secondary?: string;
  lblClass: string;
  valClass: string;
  subClass: string;
}) {
  return (
    <div className="tcg-stat">
      <span className={lblClass}>{label}</span>
      <span className={valClass}>{primary}</span>
      {secondary && <span className={subClass}>{secondary}</span>}
    </div>
  );
}

function TraitRow({
  trait,
  thresholds,
  tierId,
  lblClass,
}: {
  trait: NftData["traits"][number];
  thresholds: RarityTierThresholds;
  tierId: TierId;
  lblClass: string;
}) {
  const traitTierId =
    typeof trait.rarityPercent === "number"
      ? tierIdForPercentile(trait.rarityPercent, thresholds)
      : null;
  const visual = traitTierId ? getTierVisual(traitTierId) : null;

  return (
    <div className={`tcg-trait-row tcg-trait-row-${tierId}`}>
      <div
        className="tcg-trait-dot"
        style={{ background: visual?.accent ?? "rgba(255,255,255,.2)" }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className={`tcg-trait-type tcg-lbl-${tierId} truncate ${lblClass}`}>
            {trait.trait_type}
          </span>
          {visual && typeof trait.rarityPercent === "number" && (
            <span
              className={`tcg-trait-pct ${lblClass}`}
              style={{ color: visual.accent }}
            >
              {visual.emoji} {trait.rarityPercent.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="tcg-trait-val truncate">{trait.value}</span>
        </div>
      </div>
    </div>
  );
}
