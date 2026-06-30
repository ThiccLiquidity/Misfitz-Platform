"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { CollectionData, NftData } from "@/types";
import { BinderView } from "@/components/binder/BinderView";
import { TierStatsBar } from "@/components/collection/TierStatsBar";
import { FilterSidebar, type TierFilter, type SortKey, type TraitFilters } from "@/components/collection/FilterSidebar";
import { tierIdForPercentile } from "@/lib/rarity/tiers";
import { formatXch } from "@/lib/format";
import type { CollectionView } from "@/lib/collections/liveCollection";

function pct(n: NftData): number {
  return n.rarityRank && n.totalSupply ? (n.rarityRank / n.totalSupply) * 100 : 101;
}
function tokenNum(n: NftData): number {
  const m = n.name.match(/#?(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function CollectionBinder({ view }: { view: CollectionView }) {
  const [nfts, setNfts] = useState<NftData[]>(view.nfts);
  const [cursor, setCursor] = useState<string | null>(view.cursor);
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank-asc");
  const [traitFilters, setTraitFilters] = useState<TraitFilters>({});
  const [enriching, setEnriching] = useState(view.nfts.length > 0);
  const [progress, setProgress] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const SHELL: CollectionData = useMemo(() => ({
    slug: view.id, name: view.name, description: view.description, bannerUrl: view.bannerUrl,
    iconUrl: view.imageUrl, nftCount: nfts.length, totalSupply: view.totalSupply,
    theme: { accent: "#8b5cf6" }, dexieCollectionId: view.id,
  }), [view, nfts.length]);

  // Batched enrichment (shared /api/binder route): fetch per-NFT traits + estimated ranks, merge in
  // place. Floor is locked from the page so values stay stable; only the rarity premium refines.
  const enrich = useCallback(async (cards: NftData[], withProgress: boolean) => {
    const ids = cards.map((c) => c.launcherId);
    if (ids.length === 0) return;
    const floors = view.floorXch != null ? { [view.id]: view.floorXch } : {};
    const CHUNK = 24;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    if (withProgress) { setEnriching(true); setProgress(0); }
    let done = 0;
    for (const chunk of chunks) {
      try {
        const res = await fetch("/api/binder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: chunk, floors, xchUsdRate: view.xchUsdRate }),
        });
        const data = res.ok ? ((await res.json()) as { nfts?: NftData[] }) : null;
        if (data?.nfts) {
          const byId = new Map(data.nfts.map((n) => [n.launcherId, n]));
          setNfts((prev) => prev.map((n) => byId.get(n.launcherId) ?? n));
        }
      } catch { /* keep fast card */ }
      done += chunk.length;
      if (withProgress) setProgress(Math.min(1, done / ids.length));
    }
    if (withProgress) setEnriching(false);
  }, [view.id, view.floorXch, view.xchUsdRate]);

  // Initial enrichment of the first page.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void enrich(view.nfts, true);
  }, [enrich, view.nfts]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/collection/${view.id}/nfts?cursor=${encodeURIComponent(cursor)}`);
      const data = res.ok ? ((await res.json()) as { nfts?: NftData[]; cursor?: string | null }) : null;
      if (data?.nfts?.length) {
        setNfts((prev) => [...prev, ...data.nfts!]);
        setCursor(data.cursor ?? null);
        void enrich(data.nfts, false); // enrich the new page quietly
      } else {
        setCursor(null);
      }
    } catch { /* ignore */ }
    setLoadingMore(false);
  }

  const traitOptions = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const n of nfts) for (const t of n.traits) (map[t.trait_type] ??= new Set()).add(String(t.value));
    const r: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(map)) r[k] = [...v].sort();
    return r;
  }, [nfts]);

  const filtered = useMemo(() => {
    let r = nfts;
    if (tier !== "all") r = r.filter((n) => (n.rarityRank ? tierIdForPercentile(pct(n)) === tier : false));
    const activeTraits = Object.entries(traitFilters).filter(([, v]) => v !== "");
    if (activeTraits.length) {
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
  }, [nfts, tier, traitFilters, sort]);

  const sidebarProps = {
    tierFilter: tier, onTierFilter: setTier,
    sort, onSort: setSort,
    traitFilters, onTraitFilter: (t: string, v: string) => setTraitFilters((p) => ({ ...p, [t]: v })),
    traitOptions,
    resultCount: filtered.length, totalCount: nfts.length,
  };

  return (
    <div className="py-2">
      {/* Collection header */}
      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
        {view.imageUrl && (
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl">
            <Image src={view.imageUrl} alt={view.name} fill className="object-cover" sizes="64px" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h1 className="text-title truncate text-xl font-black">{view.name}</h1>
            {view.verified && <span className="text-sky-400" title="Verified creator">✔</span>}
          </div>
          <div className="text-subtle mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            <span>{view.totalSupply.toLocaleString()} items</span>
            <span>Floor <span className="text-title font-semibold">{view.floorXch != null ? formatXch(view.floorXch) : "—"}</span></span>
            <span>Volume <span className="text-title font-semibold">{view.volumeXch != null ? formatXch(Math.round(view.volumeXch)) : "—"}</span></span>
          </div>
        </div>
      </div>

      {enriching && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(progress * 100)}%`, background: "linear-gradient(90deg, #8b5cf6, #ec4899)" }} />
        </div>
      )}

      <TierStatsBar collection={SHELL} nfts={nfts} />

      <div className="mx-auto hidden items-start justify-center gap-4 md:flex" style={{ maxWidth: 1320 }}>
        <FilterSidebar {...sidebarProps} />
        <div className="min-w-0 flex-1" style={{ maxWidth: 960 }}>
          <BinderView collection={SHELL} nfts={filtered} />
          {cursor && (
            <div className="mt-5 flex justify-center">
              <button type="button" onClick={loadMore} disabled={loadingMore}
                className="rounded-lg border border-white/15 bg-white/[0.04] px-6 py-2.5 text-sm font-semibold text-title transition hover:bg-white/[0.08] disabled:opacity-50">
                {loadingMore ? "Loading…" : `Load more (${nfts.length} of ${view.totalSupply.toLocaleString()})`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        <BinderView collection={SHELL} nfts={filtered} />
        {cursor && (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={loadMore} disabled={loadingMore}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-6 py-2.5 text-sm font-semibold text-title disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
