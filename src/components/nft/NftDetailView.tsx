"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { NftData, CollectionData, Trait, FairValueEstimate } from "@/types";
import { NftRarityCard } from "./NftRarityCard";
import { DealScoreGauge, colorForLabel, funLabel } from "./DealScoreGauge";
import { formatUsd, formatXch, truncateAddress } from "@/lib/format";
import {
  getRarityTier,
  resolveTierThresholds,
  tierIdForPercentile,
  getTierVisual,
  type RarityTierThresholds,
} from "@/lib/rarity/tiers";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// ── Accent resolution (same map as NftDetailModal) ──────────────────────────
// Light mode: deepen tier accents so they read on white panels instead of washing out
const LIGHT_ACCENTS: Record<string, string> = {
  "#cc66ff": "#6a00aa", // mythic    — deep violet
  "#f0c000": "#7a5500", // legendary — dark amber
  "#a8d0ff": "#1144cc", // epic      — deep blue
  "#ff6060": "#aa1111", // rare      — deep red
  "#5fce7a": "#116622", // uncommon  — dark green
  "#6090e0": "#1133cc", // common    — deep indigo
};
function resolveAccent(accent: string, isLight: boolean): string {
  return isLight ? (LIGHT_ACCENTS[accent] ?? accent) : accent;
}

// ── Fair value row semantic coloring ────────────────────────────────────────
// Each component of the value estimate gets its own color language so the
// breakdown reads at a glance: gold = rarity driving value, purple = traits,
// cyan = market bonuses, muted = missing/zero.
function fvRowColor(
  key: keyof FairValueEstimate,
  value: unknown,
  totalEstimate: number,
  isLight: boolean,
): string {
  if (typeof value !== "number" || value <= 0) return ""; // fall through to subColor
  const ratio = value / (totalEstimate || 1);

  switch (key) {
    case "rarityPremium":
      // Gold when rarity is significantly boosting value
      if (ratio >= 0.25) return isLight ? "#a07400" : "#f0c000";
      if (ratio >= 0.08) return isLight ? "#16a34a" : "#22c55e";
      return "";
    case "traitPremium":
      if (ratio >= 0.15) return isLight ? "#7c3aed" : "#c084fc";
      if (ratio >= 0.05) return isLight ? "#2563eb" : "#60a5fa";
      return "";
    case "historicalSalesPremium":
    case "demandPremium":
    case "rewardValue":
      // Any positive bonus premium → cyan
      return isLight ? "#0891b2" : "#22d3ee";
    default:
      return ""; // floorValue: use default accent
  }
}

// Label color spectrum — slides from gold (rarest) through green/cyan/blue based on percentile.
// Used for section headers and descriptor text so the page "feels" as rare as the NFT is.
function rarityLabelColor(percentile: number | null, isLight: boolean): string {
  if (percentile === null) return isLight ? "rgba(80,60,140,0.60)" : "rgba(180,160,255,0.45)";
  if (percentile < 0.5)  return isLight ? "#a07400" : "#f0c000"; // gold   — top 0.5%
  if (percentile < 2)    return isLight ? "#b06000" : "#fb923c"; // amber  — top 2%
  if (percentile < 5)    return isLight ? "#16a34a" : "#22c55e"; // green  — top 5%
  if (percentile < 15)   return isLight ? "#0891b2" : "#22d3ee"; // cyan   — top 15%
  if (percentile < 30)   return isLight ? "#2563eb" : "#60a5fa"; // blue   — top 30%
  return isLight ? "rgba(80,60,140,0.60)" : "rgba(180,160,255,0.45)";  // default muted
}

// Rank chip color — gold for elite, green for top-10, default otherwise
function rankChipColor(percentile: number | null, isLight: boolean): string | null {
  if (percentile === null) return null;
  if (percentile < 1)  return isLight ? "#a07400" : "#f0c000"; // gold
  if (percentile < 10) return isLight ? "#16a34a" : "#22c55e"; // green
  return null;
}

const FV_ROWS: { key: keyof FairValueEstimate; label: string }[] = [
  { key: "floorValue",             label: "Floor value"        },
  { key: "rarityPremium",          label: "Rarity premium"     },
  { key: "traitPremium",           label: "Trait premium"      },
  { key: "historicalSalesPremium", label: "Historical sales"   },
  { key: "demandPremium",          label: "Market demand"      },
  { key: "rewardValue",            label: "Rewards / airdrops" },
];

// ── Main view ────────────────────────────────────────────────────────────────

interface NftDetailViewProps {
  nft: NftData;
  collection: CollectionData;
}

export function NftDetailView({ nft, collection }: NftDetailViewProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const thresholds = useMemo(
    () => resolveTierThresholds(collection.rarityTiers),
    [collection.rarityTiers],
  );
  const tier = useMemo(
    () => getRarityTier(nft.rarityRank, collection.totalSupply, thresholds),
    [nft.rarityRank, collection.totalSupply, thresholds],
  );

  const accent = resolveAccent(tier.accent, isLight);

  // Deal score drives the market panel's border/glow color
  const dealColor   = nft.dealScore ? colorForLabel(nft.dealScore.label) : null;
  const rankColor   = rankChipColor(tier.percentile, isLight);
  // Section header labels slide across the rarity spectrum instead of staying flat
  const rarityLbl   = rarityLabelColor(tier.percentile, isLight);

  // Panel surface tokens
  const panelBg     = isLight ? "rgba(255,255,255,0.88)"         : "rgba(20,18,28,0.92)";
  const panelBorder = isLight ? `1px solid ${accent}38`          : "1px solid rgba(255,255,255,0.07)";
  const panelShadow = isLight
    ? "0 2px 20px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.95)"
    : "0 2px 20px rgba(0,0,0,0.45)";
  // Market panel: border/glow reflects deal score so you see "green panel = buy" at a glance
  const marketBorder = dealColor
    ? `1px solid ${dealColor}55`
    : panelBorder;
  const marketShadow = dealColor
    ? isLight
      ? `0 2px 24px ${dealColor}22, inset 0 1px 0 rgba(255,255,255,0.95)`
      : `0 2px 24px ${dealColor}28`
    : panelShadow;
  const divider  = isLight ? `1px solid ${accent}18`             : "1px solid rgba(255,255,255,0.06)";
  const lblColor = isLight ? `${accent}bb`                       : "rgba(255,255,255,0.40)";
  const valColor = accent;
  const subColor = isLight ? `${accent}88`                       : "rgba(255,255,255,0.28)";

  const baseChip: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    padding: "5px 12px",
    fontSize: 13,
    fontWeight: 700,
    background: isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)",
    border: isLight ? "1px solid rgba(0,0,0,0.10)" : "1px solid rgba(255,255,255,0.10)",
    color: isLight ? "#333" : "rgba(255,255,255,0.65)",
  };

  const tierChip: React.CSSProperties = {
    ...baseChip,
    background: isLight ? `${accent}1a` : `${tier.accent}22`,
    border: `1px solid ${accent}55`,
    color: accent,
  };

  const panelStyle: React.CSSProperties = {
    background: panelBg,
    border: panelBorder,
    boxShadow: panelShadow,
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    borderRadius: 14,
    overflow: "hidden",
  };

  return (
    <div>
      {/* ── Back nav ──────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href={`/collections/${collection.slug}`}
          className="inline-flex items-center gap-2 text-sm font-semibold rounded-lg px-3 py-1.5 transition-opacity hover:opacity-70"
          style={{
            background: isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.05)",
            border: isLight ? `1px solid ${accent}22` : "1px solid rgba(255,255,255,0.08)",
            color: isLight ? accent : "rgba(255,255,255,0.50)",
          }}
        >
          ← {collection.name}
        </Link>
      </div>

      {/* ── Two-column layout ─────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 items-start">

        {/* LEFT — TCG card */}
        <div
          className="flex-shrink-0 self-center lg:self-start"
          style={{ width: "clamp(210px, 32vw, 310px)" }}
        >
          <NftRarityCard
            nft={nft}
            collectionName={collection.name}
            totalSupply={collection.totalSupply}
            rarityTiers={collection.rarityTiers}
            variant="detail"
          />
        </div>

        {/* RIGHT — info panels */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">

          {/* ── Title ─────────────────────────────────────────────────── */}
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-widest mb-1"
              style={{ color: rarityLbl }}
            >
              {collection.name}
            </p>
            <h1
              style={{
                fontFamily: "var(--font-righteous), sans-serif",
                fontSize: "clamp(1.5rem, 3vw, 2.2rem)",
                lineHeight: 1.15,
                color: isLight ? "#0e0820" : "rgba(255,255,255,0.95)",
                marginBottom: 14,
              }}
            >
              {nft.name}
            </h1>

            {/* Chips row */}
            <div className="flex flex-wrap gap-2">
              <span style={tierChip}>{tier.emoji} {tier.label.toUpperCase()}</span>
              {tier.rank !== null && (
                <span style={rankColor ? {
                  ...baseChip,
                  color: rankColor,
                  border: `1px solid ${rankColor}55`,
                  background: isLight ? `${rankColor}14` : `${rankColor}1a`,
                } : baseChip}>
                  Rank #{tier.rank}
                </span>
              )}
              {tier.percentile !== null && (
                <span style={baseChip}>{tier.percentileLabel}</span>
              )}
              {nft.rarityScore !== null && (
                <span style={baseChip}>Score {nft.rarityScore.toFixed(1)}</span>
              )}
            </div>
          </div>

          {/* ── Market panel ──────────────────────────────────────────── */}
          <div style={{ ...panelStyle, border: marketBorder, boxShadow: marketShadow }}>

            {/* 3-col price row */}
            <div className="grid grid-cols-3" style={{ borderBottom: divider }}>
              {/* Listing */}
              <div className="flex flex-col gap-1 px-4 py-4" style={{ borderRight: divider }}>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>
                  Listing
                </span>
                <span className="text-base font-bold" style={{ color: dealColor ?? valColor }}>
                  {nft.listing ? formatXch(nft.listing.priceXch) : "—"}
                </span>
                {nft.listing && (
                  <span className="text-[10px]" style={{ color: subColor }}>
                    {formatUsd(nft.listing.priceUsd)}
                  </span>
                )}
              </div>

              {/* Est. Value */}
              <div className="flex flex-col gap-1 px-4 py-4" style={{ borderRight: divider }}>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>
                  Est. Value
                </span>
                <span className="text-base font-bold" style={{ color: valColor }}>
                  {nft.fairValue ? formatXch(nft.fairValue.totalEstimate) : "—"}
                </span>
                {nft.fairValue && (
                  <span className="text-[10px]" style={{ color: subColor }}>
                    {formatUsd(nft.fairValue.totalEstimateUsd)}
                  </span>
                )}
              </div>

              {/* Deal Score */}
              <div className="flex flex-col gap-1 px-4 py-4">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>
                  Deal Score
                </span>
                {nft.dealScore ? (
                  <>
                    <DealScoreGauge score={nft.dealScore.score} />
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: colorForLabel(nft.dealScore.label) }}
                    >
                      {funLabel(nft.dealScore.label)}
                    </span>
                  </>
                ) : (
                  <span className="text-base font-bold mt-1" style={{ color: valColor }}>—</span>
                )}
              </div>
            </div>

            {/* Fair value breakdown */}
            {nft.fairValue && (
              <div className="px-4 py-4">
                <p
                  className="text-[10px] font-bold uppercase tracking-widest mb-3"
                  style={{ color: rarityLbl }}
                >
                  Value Breakdown
                </p>
                {FV_ROWS.map(({ key, label }) => {
                  const value = nft.fairValue![key];
                  const total = nft.fairValue!.totalEstimate;
                  const semanticColor = fvRowColor(key, value, total, isLight);
                  const displayColor  = semanticColor || (typeof value === "number" && value > 0 ? valColor : subColor);
                  const isSignificant = !!semanticColor && semanticColor !== "";
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between py-1.5 gap-2"
                      style={{
                        borderBottom: divider,
                        // Subtle left accent bar when a row has semantic meaning
                        borderLeft: isSignificant ? `3px solid ${semanticColor}` : "3px solid transparent",
                        paddingLeft: 8,
                      }}
                    >
                      <span className="text-xs" style={{ color: isSignificant ? displayColor : subColor }}>
                        {label}
                      </span>
                      <span
                        className="text-xs font-bold"
                        style={{
                          color: displayColor,
                          // Glow on high-significance rows
                          textShadow: isSignificant ? `0 0 12px ${semanticColor}88` : undefined,
                        }}
                      >
                        {typeof value === "number" ? `${value.toFixed(2)} XCH` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Traits panel ──────────────────────────────────────────── */}
          {nft.traits.length > 0 && (
            <div style={panelStyle}>
              <div className="px-4 pt-4 pb-3">
                <p
                  className="text-[10px] font-bold uppercase tracking-widest mb-3"
                  style={{ color: rarityLbl }}
                >
                  Traits · {nft.traits.length}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {nft.traits.map((trait) => (
                    <TraitCard
                      key={trait.trait_type}
                      trait={trait}
                      thresholds={thresholds}
                      accent={accent}
                      divider={divider}
                      lblColor={lblColor}
                      valColor={valColor}
                      isLight={isLight}
                    />
                  ))}
                </div>
              </div>

              {/* Owner + share */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{ borderTop: divider }}
              >
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: rarityLbl }}>
                    Owned by
                  </p>
                  <p className="text-xs font-semibold mt-0.5" style={{ color: valColor }}>
                    {nft.currentOwnerAddress
                      ? truncateAddress(nft.currentOwnerAddress, 10, 6)
                      : "Unknown"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(window.location.href).catch(() => {}); }}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
                  style={{
                    background: isLight ? `${accent}14` : "rgba(255,255,255,0.06)",
                    border: `1px solid ${accent}44`,
                    color: accent,
                  }}
                >
                  ⧉ Share
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Trait card ────────────────────────────────────────────────────────────────

function TraitCard({
  trait,
  thresholds,
  accent,
  divider,
  lblColor,
  valColor,
  isLight,
}: {
  trait: Trait;
  thresholds: RarityTierThresholds;
  accent: string;
  divider: string;
  lblColor: string;
  valColor: string;
  isLight: boolean;
}) {
  const traitTierId =
    typeof trait.rarityPercent === "number"
      ? tierIdForPercentile(trait.rarityPercent, thresholds)
      : null;
  const visual = traitTierId ? getTierVisual(traitTierId) : null;
  const barColor = visual
    ? resolveAccent(visual.accent, isLight)
    : accent;

  // Rarity fill: higher fill = rarer (inverted from rarityPercent which is 0-100 where lower=rarer)
  const rarityFill =
    typeof trait.rarityPercent === "number"
      ? Math.max(4, 100 - trait.rarityPercent)
      : null;

  return (
    <div
      className="rounded-lg px-3 py-2.5 flex flex-col gap-1"
      style={{
        background: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)",
        border: divider,
      }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-widest truncate"
        style={{ color: lblColor }}
      >
        {trait.trait_type}
      </span>
      <span className="text-xs font-bold truncate" style={{ color: barColor }}>
        {String(trait.value)}
      </span>
      {typeof trait.rarityPercent === "number" && rarityFill !== null && (
        <div className="flex items-center gap-2 mt-0.5">
          <div
            className="flex-1 rounded-full overflow-hidden"
            style={{
              height: 3,
              background: isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)",
            }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${rarityFill}%`, background: barColor, opacity: 0.85 }}
            />
          </div>
          <span className="text-[9px] font-bold flex-shrink-0" style={{ color: barColor }}>
            {visual?.emoji} {trait.rarityPercent.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
