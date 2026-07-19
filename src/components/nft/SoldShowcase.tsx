"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { formatUsd, formatXch, timeAgo } from "@/lib/format";
import { getRarityTier } from "@/lib/rarity/tiers";

// A shareable "SOLD" card — the detail card reimagined as a sale you can screenshot and post. It is
// ALWAYS rendered dark-vault (theme-independent) so every share looks the same, sized to a portrait
// frame (`#tf-sold-card`, ~360px) that crops cleanly. Chrome (Close / Copy) lives OUTSIDE the frame so
// it never lands in the screenshot. Data comes from whatever opened it — the collection sales rail
// (thumb/rank/price/date) or a per-card sale row in the detail modal (adds top traits).
export interface SoldShowcaseData {
  name: string;
  imageUrl: string | null;
  launcherId?: string | null;    // hex/nft1 id — powers the "Copy link" (MintGarden) button
  rank: number | null;
  totalSupply: number | null;
  priceXch: number;
  date: string | null;           // ISO sale date
  xchUsdRate?: number;           // for the USD subline; omitted -> no USD shown
  traits?: { type: string; value: string }[]; // optional; top few shown as chips
  collectionName?: string | null;
}

function fullDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function SoldShowcase({ sale, onClose }: { sale: SoldShowcaseData; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Lock the page behind the overlay so the share card doesn't scroll the collection underneath (mobile).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const tier = getRarityTier(sale.rank, sale.totalSupply ?? 0);
  const saleAgeDays = sale.date ? (Date.now() - Date.parse(sale.date)) / 86_400_000 : Infinity;
  const usdFresh = Number.isFinite(saleAgeDays) && saleAgeDays <= 7; // today's XCH rate is only fair for a recent sale
  const usd = usdFresh && sale.xchUsdRate && sale.xchUsdRate > 0 ? sale.priceXch * sale.xchUsdRate : null;
  const dateAbs = fullDate(sale.date);
  const mgUrl = sale.launcherId ? `https://mintgarden.io/nfts/${sale.launcherId}` : null;
  const chips = (sale.traits ?? []).slice(0, 3);

  const copyLink = async () => {
    if (!mgUrl) return;
    try { await navigator.clipboard.writeText(mgUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 py-8"
      style={{ background: "rgba(3,7,14,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${sale.name} sold for ${formatXch(sale.priceXch)} XCH`}
    >
      <div className="m-auto flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {/* ── The share frame (this is what gets screenshotted) ── */}
        <div
          id="tf-sold-card"
          data-theme="dark"
          className="relative w-full overflow-hidden rounded-2xl"
          style={{
            maxWidth: 360,
            background: "radial-gradient(120% 90% at 50% 0%, #10203a 0%, #0a1524 55%, #060d18 100%)",
            border: "1px solid rgba(255,224,106,0.28)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 0 60px rgba(255,224,106,0.05)",
          }}
        >
          {/* Art with the SOLD stamp */}
          <div className="relative aspect-square w-full overflow-hidden" style={{ background: "#05080f" }}>
            {sale.imageUrl ? (
              <Image src={sale.imageUrl} alt={sale.name} fill className="object-cover" sizes="360px" unoptimized priority />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl" style={{ color: "rgba(255,224,106,0.3)" }}>◈</div>
            )}
            <div className="tf-sold-stamp" aria-hidden>SOLD</div>
            {/* top gradient so the tier badge reads over any art */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-16" style={{ background: "linear-gradient(180deg, rgba(3,7,14,0.7), transparent)" }} />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black"
              style={{ background: "rgba(3,7,14,0.6)", border: `1px solid ${tier.accent}66`, color: tier.accent }}>
              <span>{tier.emoji}</span>
              <span>{tier.rank ? `#${tier.rank}` : "Unranked"}</span>
              {tier.percentile != null && <span style={{ opacity: 0.85 }}>· {tier.percentileLabel}</span>}
            </div>
          </div>

          {/* Sale data */}
          <div className="px-5 pb-5 pt-4 text-center">
            <div className="truncate text-lg font-black" style={{ color: "#f4ecd6" }}>{sale.name}</div>
            {sale.collectionName && (
              <div className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(233,207,148,0.65)" }}>{sale.collectionName}</div>
            )}

            <div className="mt-3.5 mb-1 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(233,207,148,0.7)" }}>Sold for</div>
            <div className="tf-foil text-5xl font-black leading-none tabular-nums">{formatXch(sale.priceXch)}</div>
            <div className="mt-1 text-sm font-black tracking-wide" style={{ color: "#e8cf94" }}>XCH</div>
            {usd != null && <div className="mt-1 text-sm font-semibold tabular-nums" style={{ color: "rgba(217,200,150,0.85)" }}>{formatUsd(Math.round(usd * 100) / 100)}</div>}

            {(dateAbs || sale.date) && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ background: "rgba(255,224,106,0.07)", border: "1px solid rgba(255,224,106,0.2)", color: "#e8cf94" }}>
                <span>{dateAbs ?? "—"}</span>
                {sale.date && <span style={{ opacity: 0.6 }}>· {timeAgo(sale.date)}</span>}
              </div>
            )}

            {chips.length > 0 && (
              <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
                {chips.map((t, i) => (
                  <span key={i} className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,224,106,0.18)", color: "#d9c896" }}>
                    <span style={{ opacity: 0.65 }}>{t.type}:</span> {t.value}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: "rgba(255,224,106,0.5)" }}>
              <span style={{ color: "var(--gold)" }}>◈</span> Traitfolio
            </div>
          </div>
        </div>

        {/* ── Chrome (outside the frame — never screenshotted) ── */}
        <div className="flex items-center gap-2">
          {mgUrl && (
            <button type="button" onClick={copyLink}
              className="rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-80"
              style={{ background: "rgba(255,224,106,0.12)", border: "1px solid rgba(255,224,106,0.35)", color: "var(--gold)" }}>
              {copied ? "Link copied ✓" : "Copy link"}
            </button>
          )}
          <button type="button" onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#e6e6e6" }}>
            Close
          </button>
        </div>
        <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Screenshot the card above to share the sale</div>
      </div>
    </div>
  );
}
