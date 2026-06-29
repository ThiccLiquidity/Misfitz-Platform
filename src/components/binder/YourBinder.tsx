"use client";

import { useMemo, useState } from "react";
import type { CollectionData, NftData } from "@/types";
import { BinderView } from "./BinderView";
import { TIER_ORDER, tierIdForPercentile, getTierVisual, type TierId } from "@/lib/rarity/tiers";
import { formatUsd, formatXch } from "@/lib/format";
import type { MyHoldings } from "@/lib/portfolio/myHoldings";

// Mixed-collection "binder shell" — cards compute rarity from each NFT's own totalSupply, so the
// synthetic collection here only supplies theme + the page chrome.
const SHELL: CollectionData = {
  slug: "my-binder",
  name: "Your Binder",
  description: null,
  bannerUrl: null,
  iconUrl: null,
  nftCount: 0,
  totalSupply: 0,
  theme: { accent: "#5fce7a" },
  dexieCollectionId: null,
};

// Rarity percentile (lower = rarer), using each NFT's own collection size — comparable across
// collections (VALUATION.md). Unranked sinks to the middle.
function percentile(n: NftData): number {
  return n.rarityRank && n.totalSupply ? (n.rarityRank / n.totalSupply) * 100 : 50;
}

export function YourBinder({ holdings }: { holdings: MyHoldings }) {
  const [tier, setTier] = useState<TierId | "all">("all");
  const [collectionId, setCollectionId] = useState<string>("all");
  const [rarest, setRarest] = useState(true);

  const filtered = useMemo(() => {
    let r = holdings.nfts;
    if (collectionId !== "all") r = r.filter((n) => n.collectionSlug === collectionId);
    if (tier !== "all") r = r.filter((n) => tierIdForPercentile(percentile(n)) === tier);
    return [...r].sort((a, b) => (rarest ? percentile(a) - percentile(b) : percentile(b) - percentile(a)));
  }, [holdings.nfts, tier, collectionId, rarest]);

  const shownValue = useMemo(
    () => Math.round(filtered.reduce((s, n) => s + (n.fairValue?.totalEstimate ?? 0), 0) * 100) / 100,
    [filtered],
  );

  const binderKey = `${tier}|${collectionId}|${rarest}`;

  return (
    <div className="mx-auto max-w-6xl px-2">
      {holdings.demo && (
        <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-400">
          Demo binder (seeded Misfitz) — sign in or paste an address to see your real collection.
        </p>
      )}

      {/* Value header */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-5">
        <div>
          <div className="text-subtle text-xs uppercase tracking-wide">
            {collectionId === "all" ? "Your collection value" : "This collection's value"}
          </div>
          <div className="text-title mt-1 text-3xl font-bold">{formatXch(shownValue)}</div>
          <div className="text-subtle text-sm">≈ {formatUsd(Math.round(shownValue * holdings.xchUsdRate * 100) / 100)}</div>
        </div>
        <div className="text-right">
          <div className="text-title text-lg font-semibold">{filtered.length} NFTs</div>
          <div className="text-subtle text-xs">
            {holdings.collections.length} collection{holdings.collections.length === 1 ? "" : "s"}
            {holdings.truncated ? " · capped" : ""}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {holdings.collections.length > 1 && (
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className="text-title rounded-lg border border-white/15 bg-card-bg px-3 py-1.5 text-xs outline-none"
          >
            <option value="all">All collections</option>
            {holdings.collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => setRarest((v) => !v)}
          className="text-subtle rounded-full border border-white/15 px-3 py-1 text-xs transition hover:border-white/30"
        >
          {rarest ? "Rarest first" : "Most common first"}
        </button>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setTier("all")}
            className={`rounded-full border px-3 py-1 text-xs transition ${tier === "all" ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300" : "text-subtle border-white/10 hover:border-white/25"}`}
          >
            All
          </button>
          {TIER_ORDER.map((t) => {
            const v = getTierVisual(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${tier === t ? "border-white/40 bg-white/10" : "text-subtle border-white/10 hover:border-white/25"}`}
                style={tier === t ? { color: v.accent } : undefined}
                title={v.label}
              >
                {v.emoji} {v.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        {filtered.length === 0 ? (
          <p className="text-subtle py-16 text-center text-sm">No NFTs match this filter.</p>
        ) : (
          <BinderView key={binderKey} collection={SHELL} nfts={filtered} />
        )}
      </div>
    </div>
  );
}
