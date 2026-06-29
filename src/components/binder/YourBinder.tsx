"use client";

import { useMemo, useState } from "react";
import type { CollectionData, NftData } from "@/types";
import { BinderView } from "./BinderView";
import { TierStatsBar } from "@/components/collection/TierStatsBar";
import { FilterSidebar, type TierFilter, type SortKey, type TraitFilters } from "@/components/collection/FilterSidebar";
import { tierIdForPercentile } from "@/lib/rarity/tiers";
import { formatUsd, formatXch } from "@/lib/format";
import type { MyHoldings } from "@/lib/portfolio/myHoldings";

// Binder shell — cards compute rarity from each NFT's own totalSupply, so this only supplies theme.
const SHELL: CollectionData = {
  slug: "my-binder",
  name: "Your Binder",
  description: null,
  bannerUrl: null,
  iconUrl: null,
  nftCount: 0,
  totalSupply: 0,
  theme: { accent: "#8b5cf6" },
  dexieCollectionId: null,
};

// Rarity percentile (lower = rarer), using each NFT's own collection size (VALUATION.md).
function pct(n: NftData): number {
  return n.rarityRank && n.totalSupply ? (n.rarityRank / n.totalSupply) * 100 : 101;
}
function tokenNum(n: NftData): number {
  const m = n.name.match(/#?(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function YourBinder({ holdings }: { holdings: MyHoldings }) {
  const [collectionId, setCollectionId] = useState<string>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank-asc");
  const [traitFilters, setTraitFilters] = useState<TraitFilters>({});

  const oneCollection = collectionId !== "all";

  // Scope to the chosen collection first (the tier bar + traits reflect this scope).
  const scoped = useMemo(
    () => (oneCollection ? holdings.nfts.filter((n) => n.collectionSlug === collectionId) : holdings.nfts),
    [holdings.nfts, collectionId, oneCollection],
  );

  // Traits only exist once you've narrowed to a single collection.
  const traitOptions = useMemo(() => {
    if (!oneCollection) return {};
    const map: Record<string, Set<string>> = {};
    for (const n of scoped) for (const t of n.traits) (map[t.trait_type] ??= new Set()).add(String(t.value));
    const r: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(map)) r[k] = [...v].sort();
    return r;
  }, [scoped, oneCollection]);

  const filtered = useMemo(() => {
    let r = scoped;
    if (tier !== "all") r = r.filter((n) => (n.rarityRank ? tierIdForPercentile(pct(n)) === tier : false));
    const activeTraits = Object.entries(traitFilters).filter(([, v]) => v !== "");
    if (oneCollection && activeTraits.length) {
      r = r.filter((n) => activeTraits.every(([t, v]) => n.traits.some((tr) => tr.trait_type === t && String(tr.value) === v)));
    }
    const s = [...r];
    switch (sort) {
      case "rank-asc":   s.sort((a, b) => pct(a) - pct(b)); break;
      case "rank-desc":  s.sort((a, b) => pct(b) - pct(a)); break;
      case "deal-desc":  s.sort((a, b) => (b.dealScore?.score ?? -1) - (a.dealScore?.score ?? -1)); break;
      case "token-asc":  s.sort((a, b) => tokenNum(a) - tokenNum(b)); break;
      case "token-desc": s.sort((a, b) => tokenNum(b) - tokenNum(a)); break;
    }
    return s;
  }, [scoped, tier, traitFilters, sort, oneCollection]);

  const shownValue = useMemo(
    () => Math.round(filtered.reduce((s, n) => s + (n.fairValue?.totalEstimate ?? 0), 0) * 100) / 100,
    [filtered],
  );

  const collectionSelect = (
    <select
      value={collectionId}
      onChange={(e) => {
        setCollectionId(e.target.value);
        setTraitFilters({});
        setTier("all");
      }}
      className="text-title w-full rounded-lg border border-white/15 bg-card-bg px-3 py-2 text-xs font-semibold outline-none"
    >
      <option value="all">All collections ({holdings.nfts.length})</option>
      {holdings.collections.map((c) => (
        <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
      ))}
    </select>
  );

  const sidebarProps = {
    tierFilter: tier, onTierFilter: setTier,
    sort, onSort: setSort,
    traitFilters, onTraitFilter: (t: string, v: string) => setTraitFilters((p) => ({ ...p, [t]: v })),
    traitOptions,
    resultCount: filtered.length, totalCount: scoped.length,
    hideTraits: !oneCollection,
  };

  const binderKey = `${collectionId}|${tier}|${sort}|${JSON.stringify(traitFilters)}`;

  return (
    <div className="mx-auto max-w-6xl px-2">
      {holdings.demo && (
        <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-400">
          Demo binder (seeded Misfitz) — sign in or paste an address to see your real collection.
        </p>
      )}

      {/* Value header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-5">
        <div>
          <div className="text-subtle text-xs uppercase tracking-wide">
            {oneCollection ? "This collection's value" : "Your collection value"}
          </div>
          <div className="text-title mt-1 text-3xl font-bold">{formatXch(shownValue)}</div>
          <div className="text-subtle text-sm">≈ {formatUsd(Math.round(shownValue * holdings.xchUsdRate * 100) / 100)}</div>
        </div>
        <div className="text-right">
          <div className="text-title text-lg font-semibold">{filtered.length} NFTs</div>
          <div className="text-subtle text-xs">
            {holdings.collections.length} collection{holdings.collections.length === 1 ? "" : "s"}{holdings.truncated ? " · capped" : ""}
          </div>
        </div>
      </div>

      <TierStatsBar collection={SHELL} nfts={scoped} />

      {/* Desktop: sidebar (collection picker + filters) + binder */}
      <div className="mx-auto hidden items-start justify-center gap-4 md:flex" style={{ maxWidth: 1440 }}>
        <div className="flex flex-shrink-0 flex-col gap-2" style={{ width: 184 }}>
          {collectionSelect}
          <FilterSidebar {...sidebarProps} />
        </div>
        <div className="min-w-0 flex-1" style={{ maxWidth: 930 }}>
          <BinderView key={binderKey} collection={SHELL} nfts={filtered} />
        </div>
      </div>

      {/* Mobile: collection + sort on top, then binder */}
      <div className="flex flex-col gap-2 md:hidden">
        <div className="flex gap-2">
          <div className="flex-1">{collectionSelect}</div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-title flex-1 rounded-lg border border-white/15 bg-card-bg px-3 py-2 text-xs font-semibold outline-none"
          >
            <option value="rank-asc">Rarest first</option>
            <option value="rank-desc">Most common first</option>
            <option value="deal-desc">Best deals first</option>
          </select>
        </div>
        <BinderView key={`m-${binderKey}`} collection={SHELL} nfts={filtered} />
      </div>
    </div>
  );
}
