"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { NftData } from "@/types";
import type { FairValueEstimate } from "@/types";
import { NftRarityCard } from "./NftRarityCard";
import { DealScoreGauge, colorForLabel } from "./DealScoreGauge";
import { formatUsd, formatXch } from "@/lib/format";
import type { RarityTierThresholds } from "@/lib/rarity/tiers";
import { getRarityTier, resolveTierThresholds } from "@/lib/rarity/tiers";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Every tier accent is deepened for light-mode so it reads on the white panel.
// Alpha-on-white washes out pastels — use fully saturated dark variants instead.
const LIGHT_MODE_ACCENTS: Record<string, string> = {
  "#cc66ff": "#6a00aa",  // mythic  — deep violet
  "#f0c000": "#7a5500",  // legendary — dark amber
  "#a8d0ff": "#1144cc",  // epic   — deep blue
  "#ff6060": "#aa1111",  // rare   — deep red
  "#5fce7a": "#116622",  // uncommon — dark green
  "#6090e0": "#1133cc",  // common  — deep blue
};
function resolveAccent(accent: string, isLight: boolean): string {
  return isLight ? (LIGHT_MODE_ACCENTS[accent] ?? accent) : accent;
}

const FV_ROWS: { key: keyof FairValueEstimate; label: string }[] = [
  { key: "floorValue",             label: "Floor value"       },
  { key: "rarityPremium",          label: "Rarity premium"    },
  { key: "desirabilityPremium",    label: "Collector appeal"  },
  { key: "traitPremium",           label: "Trait demand"      },
  { key: "demandPremium",          label: "Trait heat"        },
  { key: "historicalSalesPremium", label: "Historical sales"  },
  { key: "rewardValue",            label: "Rewards / airdrops"},
];

interface NftDetailModalProps {
  nft: NftData;
  collectionName: string;
  totalSupply: number;
  rarityTiers?: Partial<RarityTierThresholds>;
  onClose: () => void;
  // Where the "View Full Page" button links. undefined = default DB collection route;
  // null = hide the button (live NFTs from MintGarden have no on-platform page).
  fullPageHref?: string | null;
}

export function NftDetailModal({
  nft, collectionName, totalSupply, rarityTiers, onClose, fullPageHref,
}: NftDetailModalProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const thresholds = useMemo(() => resolveTierThresholds(rarityTiers), [rarityTiers]);
  const tier = useMemo(
    () => getRarityTier(nft.rarityRank, totalSupply, thresholds),
    [nft.rarityRank, totalSupply, thresholds],
  );

  // Panel colours — solid backgrounds so they read over the black overlay
  const resolvedFullPageHref =
    fullPageHref === undefined
      ? `/collections/${nft.collectionSlug}/nfts/${nft.launcherId}`
      : fullPageHref;

  const [copyState, setCopyState] = useState<"idle" | "loading" | "copied" | "none">("idle");
  async function copyOfferFile(e: React.MouseEvent) {
    e.stopPropagation();
    setCopyState("loading");
    try {
      const res = await fetch(`/api/offer?nft=${encodeURIComponent(nft.launcherId)}`);
      const data = res.ok ? ((await res.json()) as { offer?: string | null }) : null;
      if (data?.offer) {
        await navigator.clipboard.writeText(data.offer);
        setCopyState("copied");
      } else {
        setCopyState("none");
      }
    } catch {
      setCopyState("none");
    }
    setTimeout(() => setCopyState("idle"), 2600);
  }

  const accentColor = resolveAccent(tier.accent, isLight);
  const panelBg     = isLight ? "rgba(255,255,255,0.97)" : "rgba(18,18,24,0.97)";
  const panelBorder = isLight ? `1px solid ${accentColor}55` : "1px solid rgba(255,255,255,0.08)";
  const divider     = isLight ? `${accentColor}33`        : "rgba(255,255,255,0.07)";
  const lblColor    = isLight ? `${accentColor}cc`        : "rgba(255,255,255,0.42)";  // 80%
  const valColor    = accentColor;                                                       // 100%
  const subColor    = isLight ? `${accentColor}99`        : "rgba(255,255,255,0.32)";  // 60%

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 py-10"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={nft.name}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative mx-4 w-full"
        style={{ maxWidth: 340 }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          type="button"
          aria-label="Close"
          className="absolute -right-2 -top-2 z-20 rounded-full bg-card-bg px-2 py-1 text-sm text-subtle shadow hover:opacity-70"
        >
          ✕
        </button>

        {/* The card itself — clean collector view: art + traits + rank */}
        <NftRarityCard
          nft={nft}
          collectionName={collectionName}
          totalSupply={totalSupply}
          rarityTiers={rarityTiers}
          variant="detail"
        />

        {/* ── Market Panel ─────────────────────────────────────────────── */}
        <div
          className="mt-3 rounded-xl overflow-hidden"
          style={{
            background: panelBg,
            border: panelBorder,
            backdropFilter: "blur(16px)",
            boxShadow: isLight
              ? "0 4px 20px rgba(0,60,140,0.10), inset 0 1px 0 rgba(255,255,255,0.8)"
              : "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          {/* Tier + Rank header */}
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: `1px solid ${divider}` }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: tier.accent }}>
                {tier.emoji} {tier.label.toUpperCase()}
              </span>
              {nft.collectible && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: `${accentColor}22`, color: accentColor }}
                >
                  ★ {nft.collectible.label}
                </span>
              )}
            </div>
            {tier.rank !== null && (
              <span className="text-xs" style={{ color: lblColor }}>
                Rank {nft.rankEstimated ? "≈#" : "#"}{tier.rank}
              </span>
            )}
          </div>

          {/* Price stats: Listing | Est. Value | Deal Score */}
          <div
            className="grid grid-cols-3"
            style={{ borderBottom: `1px solid ${divider}` }}
          >
            {/* Listing */}
            <div
              className="flex flex-col gap-0.5 px-3 py-3"
              style={{ borderRight: `1px solid ${divider}` }}
            >
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>
                Listing
              </span>
              <span className="text-sm font-bold" style={{ color: valColor }}>
                {nft.listing ? formatXch(nft.listing.priceXch) : "—"}
              </span>
              {nft.listing && (
                <span className="text-[10px]" style={{ color: subColor }}>
                  {formatUsd(nft.listing.priceUsd)}
                </span>
              )}
            </div>

            {/* Est. Value */}
            <div
              className="flex flex-col gap-0.5 px-3 py-3"
              style={{ borderRight: `1px solid ${divider}` }}
            >
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>
                Est. Value
              </span>
              <span className="text-sm font-bold" style={{ color: valColor }}>
                {nft.fairValue ? formatXch(nft.fairValue.totalEstimate) : "—"}
              </span>
              {nft.fairValue && (
                <span className="text-[10px]" style={{ color: subColor }}>
                  {formatUsd(nft.fairValue.totalEstimateUsd)}
                </span>
              )}
            </div>

            {/* Deal Score */}
            <div className="flex flex-col gap-0.5 px-3 py-3">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>
                Deal Score
              </span>
              {nft.dealScore ? (
                <>
                  <DealScoreGauge score={nft.dealScore.score} label={nft.dealScore.label} />
                  <span className="text-[10px] font-bold" style={{ color: colorForLabel(nft.dealScore.label) }}>
                    {nft.dealScore.label}
                  </span>
                </>
              ) : (
                <span className="text-sm font-bold" style={{ color: valColor }}>—</span>
              )}
            </div>
          </div>

          {/* Multi-asset warning — the listing wants a CAT (or bundle) on top of XCH */}
          {(nft.listingAssets ?? []).some((a) => a !== "XCH") && (
            <div className="mx-4 mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-300">
              ⚠ This offer also requires{" "}
              <span className="font-bold">{(nft.listingAssets ?? []).filter((a) => a !== "XCH").join(", ")}</span>{" "}
              in addition to XCH. The price shown is the XCH portion only — this is <span className="font-bold">not</span>{" "}
              a clean XCH buy, so no deal score is given. Verify the full offer before purchasing.
            </div>
          )}

          {/* Buy / View on MintGarden — external link (we never execute trades in-app) */}
          {nft.launcherId.startsWith("nft1") && (
            <div className="px-4 pt-3 pb-1" style={{ borderTop: `1px solid ${divider}` }}>
              <a
                href={`https://mintgarden.io/nfts/${nft.launcherId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition-opacity hover:opacity-80"
                style={{
                  background: nft.listing ? "rgba(40,180,90,0.16)" : `${accentColor}18`,
                  border: `1px solid ${nft.listing ? "rgba(80,200,120,0.5)" : `${accentColor}44`}`,
                  color: nft.listing ? "#5fce7a" : accentColor,
                }}
              >
                {nft.listing ? `Buy · ${formatXch(nft.listing.priceXch)} on MintGarden ↗` : "View on MintGarden ↗"}
              </a>
            </div>
          )}

          {/* Copy offer file — pastes the seller's Dexie offer string into the user's wallet to accept */}
          {nft.listing && (
            <div className="px-4 pb-1">
              <button
                type="button"
                onClick={copyOfferFile}
                disabled={copyState === "loading"}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-60"
                style={{
                  background: copyState === "copied" ? "rgba(40,180,90,0.16)" : isLight ? "rgba(10,30,80,0.06)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${copyState === "copied" ? "rgba(80,200,120,0.5)" : isLight ? "rgba(60,120,220,0.3)" : "rgba(255,255,255,0.14)"}`,
                  color: copyState === "copied" ? "#5fce7a" : isLight ? "#0a1e50" : "rgba(255,255,255,0.85)",
                }}
              >
                {copyState === "loading"
                  ? "Fetching offer…"
                  : copyState === "copied"
                    ? "✓ Offer file copied — paste in your wallet"
                    : copyState === "none"
                      ? "No offer file found on Dexie"
                      : "📋 Copy offer file"}
              </button>
            </div>
          )}

          {/* View Full Page link */}
          {resolvedFullPageHref !== null && (
            <div className="px-4 pt-3 pb-1" style={{ borderTop: `1px solid ${divider}` }}>
              <Link
                href={resolvedFullPageHref}
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full rounded-lg py-2 text-xs font-bold transition-opacity hover:opacity-80"
                style={{
                  background: isLight ? `${accentColor}14` : `${accentColor}18`,
                  border: `1px solid ${accentColor}44`,
                  color: accentColor,
                }}
              >
                View Full Page →
              </Link>
            </div>
          )}

          {/* Fair Value Breakdown */}
          {nft.fairValue && (
            <div className="px-4 py-3">
              <div
                className="mb-2 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: lblColor }}
              >
                Where this value comes from
              </div>
              {FV_ROWS.map(({ key, label }) => {
                const value = nft.fairValue![key];
                return (
                  <div
                    key={key}
                    className="flex items-baseline justify-between py-1"
                    style={{ borderBottom: `1px solid ${divider}` }}
                  >
                    <span className="text-xs" style={{ color: subColor }}>{label}</span>
                    <span
                      className="text-xs font-semibold"
                      style={{ color: typeof value === "number" ? valColor : subColor }}
                    >
                      {typeof value === "number" ? `${value.toFixed(2)} XCH` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
