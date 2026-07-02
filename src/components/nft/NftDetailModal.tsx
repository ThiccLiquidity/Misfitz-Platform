"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { NftData } from "@/types";
import type { FairValueEstimate } from "@/types";
import { NftRarityCard } from "./NftRarityCard";
import { DealScoreGauge, colorForLabel, funLabel } from "./DealScoreGauge";
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
  { key: "floorValue",          label: "Floor value"      },
  { key: "rarityPremium",       label: "Rarity premium"   },
  { key: "desirabilityPremium", label: "Collector number" },
  { key: "traitPremium",        label: "Trait demand"     },
];

// "Background:Gold" -> "Gold (Background)" for the trait-demand row.
function hotTraitLabel(kv?: string | null): string | null {
  if (!kv) return null;
  const i = kv.indexOf(":");
  if (i < 0) return kv;
  return `${kv.slice(i + 1)} (${kv.slice(0, i)})`;
}

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
  const [lightbox, setLightbox] = useState(false);
  const [showValueInfo, setShowValueInfo] = useState(false); // tap-to-toggle (touch has no hover)
  const [expandTrait, setExpandTrait] = useState(false);
  // Keyboard: Escape closes the lightbox if open, otherwise the modal (a11y).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(false); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, onClose]);
  // Market-curve breakdown pieces (multiplicative: estimate = curve × traitMult × collectorMult).
  const curveBase = nft.valueCurve ?? 0;
  const traitMult = typeof nft.valueTraitMult === "number" ? nft.valueTraitMult : 1;
  const traitEffect = nft.valueCurve != null ? curveBase * (traitMult - 1) : 0;        // value added by trait demand
  const numberPremium = nft.valueCurve != null && nft.fairValue
    ? Math.max(0, nft.fairValue.totalEstimate - curveBase * traitMult) : 0;             // value added by collector number

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

  const accentColor = resolveAccent(tier.accent, isLight);
  const panelBg     = isLight ? "rgba(255,255,255,0.97)" : "rgba(18,18,24,0.97)";
  const panelBorder = isLight ? `1px solid ${accentColor}55` : "1px solid rgba(255,255,255,0.08)";
  const divider     = isLight ? `${accentColor}55`        : "rgba(255,255,255,0.07)";
  const lblColor    = isLight ? `${accentColor}cc`        : "rgba(255,255,255,0.42)";  // 80%
  const valColor    = accentColor;                                                       // 100%
  const subColor    = isLight ? `${accentColor}99`        : "rgba(255,255,255,0.32)";  // 60%

  // When an NFT is listed on MintGarden's own book (not Dexie), the MintGarden link IS the buy path.
  const mgIsBuy = !!nft.listing && !nft.dexieOfferId;
  const mgBuyLabel = mgIsBuy
    ? `Buy \u00b7 ${formatXch(nft.listing!.priceXch)} XCH on MintGarden \u2197`
    : "View NFT on MintGarden \u2197";

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
          className="absolute -right-2 -top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-card-bg text-base text-subtle shadow hover:opacity-70"
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
          onArtClick={() => setLightbox(true)}
        />

        {/* Full-screen lightbox — just the NFT art, big and clean. Click anywhere / ✕ to close. */}
        {lightbox && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/[0.97] p-4 backdrop-blur-md sm:p-10"
            onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
            role="dialog"
            aria-modal="true"
            aria-label={`${nft.name} full image`}
          >
            <button
              type="button"
              aria-label="Close image"
              onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
              className="absolute right-4 top-4 z-10 rounded-full bg-white/10 px-3 py-1.5 text-lg text-white transition hover:bg-white/20"
            >
              ✕
            </button>
            <div className="relative aspect-square w-full max-w-md sm:max-w-lg" style={{ maxHeight: "72vh" }}>
              <Image src={nft.imageUrl} alt={nft.name} fill className="object-contain" sizes="(max-width:640px) 90vw, 512px" priority />
            </div>
          </div>
        )}

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
                  <DealScoreGauge score={nft.dealScore.score} />
                  <span className="text-[10px] font-bold" style={{ color: colorForLabel(nft.dealScore.label) }}>
                    {funLabel(nft.dealScore.label)}
                  </span>
                </>
              ) : (
                <span className="text-sm font-bold" style={{ color: valColor }}>—</span>
              )}
            </div>
          </div>

          {/* What the buyer must give — full breakdown (XCH + any CATs), with the CAT warning */}
          {nft.listing && (nft.listingRequested?.length ?? 0) > 0 && (
            <div
              className="mx-4 mt-3 rounded-lg px-3 py-3 text-center"
              style={{ border: `1px solid ${divider}`, background: isLight ? "rgba(10,30,80,0.04)" : "rgba(255,255,255,0.03)" }}
            >
              <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>You pay</div>
              <div className="mt-1.5 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1">
                {nft.listingRequested!.map((r) => (
                  <span key={r.code} className="inline-flex items-baseline gap-1.5">
                    <span className="text-2xl font-black leading-none" style={{ color: valColor }}>{r.amount}</span>
                    <span className="text-xs font-semibold" style={{ color: subColor }}>{r.code}</span>
                  </span>
                ))}
              </div>
              {(nft.listingAssets ?? []).some((a) => a !== "XCH") && (
                <div
                  className="mt-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold leading-snug"
                  style={{ border: "1.5px solid rgba(240,140,40,0.7)", background: "rgba(240,140,40,0.12)", color: "#f4a940" }}
                >
                  <div className="mb-1 text-[13px] font-black uppercase tracking-wide">⚠ This offer includes CAT tokens</div>
                  The <span className="font-bold">{formatXch(nft.listing.priceXch)} XCH</span> above is ONLY the XCH part —
                  this trade also requires the CAT token(s) listed. We don&apos;t price CATs yet, so <span className="font-bold">no
                  deal score is shown</span> and the total real cost is higher than the XCH figure.
                  <div className="mt-1.5 font-bold">Always open the offer on Dexie and verify EXACTLY what leaves and enters your wallet before accepting.</div>
                </div>
              )}
            </div>
          )}

          {/* Unverified MintGarden listing — price shown, but we couldn't read the full offer terms. */}
          {nft.listing && nft.listingUnverified && (
            <div
              className="mx-4 mt-3 rounded-lg px-3 py-2 text-[11px] leading-snug text-amber-300"
              style={{ border: "1px solid rgba(217,160,60,0.4)", background: isLight ? "rgba(180,120,20,0.06)" : "rgba(217,160,60,0.08)" }}
            >
              ⚠ This {formatXch(nft.listing.priceXch)} XCH price is from MintGarden&apos;s listing, but we couldn&apos;t
              read the full offer terms to confirm it&apos;s XCH-only. It may also require a CAT token, so no deal score is
              shown. Confirm the real terms on MintGarden before buying.
            </div>
          )}

          {/* Take the offer on Dexie — review + accept there (safer than copy/paste). No in-app trades. */}
          {nft.listing && nft.dexieOfferId && (
            <div className="px-4 pt-3 pb-1" style={{ borderTop: `1px solid ${divider}` }}>
              <a
                href={`https://dexie.space/offers/${nft.dexieOfferId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition-opacity hover:opacity-80"
                style={{ background: "rgba(45,110,225,0.16)", border: "1px solid rgba(95,150,240,0.5)", color: "#6aa0ff" }}
              >
                View &amp; take offer on Dexie ↗
              </a>
            </div>
          )}

          {/* View the NFT on MintGarden */}
          {nft.launcherId.startsWith("nft1") && (
            <div className={`px-4 pb-1 ${nft.listing && nft.dexieOfferId ? "pt-2" : "pt-3"}`} style={nft.listing && nft.dexieOfferId ? {} : { borderTop: `1px solid ${divider}` }}>
              <a
                href={`https://mintgarden.io/nfts/${nft.launcherId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition-opacity hover:opacity-80"
                style={{ background: "rgba(40,180,90,0.16)", border: "1px solid rgba(80,200,120,0.5)", color: "#5fce7a" }}
              >
                {mgBuyLabel}
              </a>
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

          {/* Value breakdown */}
          {nft.fairValue && (
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: lblColor }}>
                Where this value comes from
                <button
                  type="button"
                  onClick={() => setShowValueInfo((v) => !v)}
                  aria-label="How value is estimated"
                  aria-expanded={showValueInfo}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black"
                  style={{ border: `1px solid ${lblColor}`, color: lblColor }}
                >
                  i
                </button>
              </div>
              {showValueInfo && (
                <p className="mb-2 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ color: subColor, background: isLight ? "rgba(10,30,80,0.05)" : "rgba(255,255,255,0.04)", border: `1px solid ${divider}` }}>
                  <span className="font-bold" style={{ color: lblColor }}>How we estimate value — </span>
                  We start from the collection\u2019s floor price, then adjust for how rare this NFT is and what
                  similar NFTs have actually sold for recently. Traits buyers are chasing right now and special
                  collector numbers add a little on top. It\u2019s an estimate to guide you, not a guaranteed
                  price \u2014 always check the live market before buying or selling.
                </p>
              )}

              {nft.valueCurve != null ? (
                <>
                  <div className="flex items-baseline justify-between py-1" style={{ borderBottom: `1px solid ${divider}` }}>
                    <span className="text-xs" style={{ color: subColor }}>Market curve{nft.rarityRank ? ` (rank #${nft.rarityRank})` : ""}</span>
                    <span className="text-xs font-semibold" style={{ color: valColor }}>{nft.valueCurve.toFixed(2)} XCH</span>
                  </div>
                  {traitEffect >= 0.005 && (
                    <div className="flex items-baseline justify-between gap-2 py-1" style={{ borderBottom: `1px solid ${divider}` }}>
                      <button
                        type="button"
                        onClick={() => setExpandTrait((v) => !v)}
                        className={`min-w-0 text-left text-xs ${expandTrait ? "whitespace-normal break-words" : "truncate"}`}
                        style={{ color: subColor }}
                        title={hotTraitLabel(nft.valueTraitTop) ? `Trait demand · ${hotTraitLabel(nft.valueTraitTop)}` : "Trait demand"}
                      >
                        Trait demand{hotTraitLabel(nft.valueTraitTop) ? ` · \uD83D\uDD25 ${hotTraitLabel(nft.valueTraitTop)}` : ""}
                      </button>
                      <span className="shrink-0 text-xs font-semibold" style={{ color: "#5fce7a" }}>+{traitEffect.toFixed(2)} XCH</span>
                    </div>
                  )}
                  {numberPremium > 0.005 && (
                    <div className="flex items-baseline justify-between py-1" style={{ borderBottom: `1px solid ${divider}` }}>
                      <span className="text-xs" style={{ color: subColor }}>Collector number</span>
                      <span className="text-xs font-semibold" style={{ color: "#5fce7a" }}>+{numberPremium.toFixed(2)} XCH</span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between pt-2">
                    <span className="text-xs font-black uppercase tracking-wide" style={{ color: lblColor }}>Estimated value</span>
                    <span className="text-sm font-black" style={{ color: valColor }}>{nft.fairValue.totalEstimate.toFixed(2)} XCH</span>
                  </div>
                </>
              ) : (
                <>
                  {FV_ROWS.map(({ key, label }) => {
                    const value = nft.fairValue![key];
                    return (
                      <div key={key} className="flex items-baseline justify-between py-1" style={{ borderBottom: `1px solid ${divider}` }}>
                        <span className="text-xs" style={{ color: subColor }}>{label}</span>
                        <span className="text-xs font-semibold" style={{ color: typeof value === "number" ? valColor : subColor }}>
                          {typeof value === "number" ? `${value.toFixed(2)} XCH` : "—"}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-baseline justify-between pt-2">
                    <span className="text-xs font-black uppercase tracking-wide" style={{ color: lblColor }}>Estimated value</span>
                    <span className="text-sm font-black" style={{ color: valColor }}>{nft.fairValue.totalEstimate.toFixed(2)} XCH</span>
                  </div>
                </>
              )}

              {(nft.valueConfidence != null || nft.rarityRank == null) && (() => {
                const n = nft.valueSampleSize ?? null;
                const conf = nft.valueConfidence ?? null;
                const level = conf == null ? null : conf >= 0.66 ? "High" : conf >= 0.4 ? "Medium" : "Low";
                const thin = nft.rarityRank != null && ((n != null && n < 8) || level === "Low");
                return (
                  <div className="mt-2 border-t pt-2 text-[10px]" style={{ borderColor: divider, color: subColor }}>
                    <div className="flex items-center justify-between">
                      <span>{nft.rarityRank == null ? "Unranked \u2014 floor estimate" : "Sales confidence"}</span>
                      {level && nft.rarityRank != null && (
                        <span style={{ color: level === "Low" ? "#f4a940" : lblColor, fontWeight: 700 }}>
                          {level}{n != null ? ` \u00b7 ${n} sale${n === 1 ? "" : "s"}` : ""}
                        </span>
                      )}
                    </div>
                    {thin && (
                      <div className="mt-1" style={{ color: "#f4a940" }}>
                        Thinly traded \u2014 estimate is a rough guide, not a firm price.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
