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

const PAGE = 120; // how many cards we render at a time (the rest stay out of the DOM)

function pct(n: NftData): number {
  return n.rarityRank && n.totalSupply ? (n.rarityRank / n.totalSupply) * 100 : 101;
}
function tokenNum(n: NftData): number {
  const m = n.name.match(/#?(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function CollectionBinder({ view }: { view: CollectionView }) {
  // Start with the SSR first page (mint order), then swap to the whole collection sorted rarest-first.
  const [nfts, setNfts] = useState<NftData[]>(view.nfts);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [indexing, setIndexing] = useState(view.totalSupply > view.nfts.length);
  const [capped, setCapped] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank-asc");
  const [traitFilters, setTraitFilters] = useState<TraitFilters>({});
  const [forSaleOnly, setForSaleOnly] = useState(false);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const SHELL: CollectionData = useMemo(() => ({
    slug: view.id, name: view.name, description: view.description, bannerUrl: view.bannerUrl,
    iconUrl: view.imageUrl, nftCount: nfts.length, totalSupply: view.totalSupply,
    theme: { accent: "#8b5cf6" }, dexieCollectionId: view.id,
  }), [view, nfts.length]);

  // Pull the entire collection (cached server-side), sorted rarest-first.
  useEffect(() => {
    let cancelled = false;
    setIndexing(true);
    fetch(`/api/collection/${view.id}/all`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { nfts?: NftData[]; capped?: boolean } | null) => {
        if (cancelled || !data?.nfts?.length) return;
        setNfts(data.nfts);
        setCapped(Boolean(data.capped));
        setFullLoaded(true);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIndexing(false); });
    return () => { cancelled = true; };
  }, [view.id]);

  // ── Filtering + sorting over the WHOLE collection, then render only the visible slice ──
  const filtered = useMemo(() => {
    const minP = parseFloat(priceMin);
    const maxP = parseFloat(priceMax);
    const hasPrice = Number.isFinite(minP) || Number.isFinite(maxP);

    let r = nfts;
    if (tier !== "all") r = r.filter((n) => (n.rarityRank ? tierIdForPercentile(pct(n)) === tier : false));
    const activeTraits = Object.entries(traitFilters).filter(([, v]) => v !== "");
    if (activeTraits.length) {
      r = r.filter((n) => activeTraits.every(([t, v]) => n.traits.some((tr) => tr.trait_type === t && String(tr.value) === v)));
    }
    // Shop filters: only listed NFTs, within the price range.
    if (forSaleOnly || hasPrice) r = r.filter((n) => n.listing != null);
    if (hasPrice) {
      r = r.filter((n) => {
        const px = n.listing?.priceXch ?? Infinity;
        if (Number.isFinite(minP) && px < minP) return false;
        if (Number.isFinite(maxP) && px > maxP) return false;
        return true;
      });
    }

    const s = [...r];
    switch (sort) {
      case "rank-asc":   s.sort((a, b) => pct(a) - pct(b)); break;
      case "rank-desc":  s.sort((a, b) => pct(b) - pct(a)); break;
      case "deal-desc":  s.sort((a, b) => (b.dealScore?.score ?? -1) - (a.dealScore?.score ?? -1)); break;
      case "price-asc":  s.sort((a, b) => (a.listing?.priceXch ?? Infinity) - (b.listing?.priceXch ?? Infinity)); break;
      case "price-desc": s.sort((a, b) => (b.listing?.priceXch ?? -1) - (a.listing?.priceXch ?? -1)); break;
      case "token-asc":  s.sort((a, b) => tokenNum(a) - tokenNum(b)); break;
      case "token-desc": s.sort((a, b) => tokenNum(b) - tokenNum(a)); break;
    }
    return s;
  }, [nfts, tier, traitFilters, sort, forSaleOnly, priceMin, priceMax]);

  const listedCount = useMemo(() => nfts.reduce((c, n) => c + (n.listing ? 1 : 0), 0), [nfts]);

  const displayed = useMemo(() => filtered.slice(0, visible), [filtered, visible]);

  // Reset the window when the filter/sort changes so you always see the top of the new order.
  useEffect(() => { setVisible(PAGE); }, [tier, sort, traitFilters, forSaleOnly, priceMin, priceMax]);

  // ── Enrich just the visible cards (traits + estimated ranks), tracked so we never re-fetch one ──
  const enrichedRef = useRef<Set<string>>(new Set());
  const enrich = useCallback(async (cards: NftData[]) => {
    const floors = view.floorXch != null ? { [view.id]: view.floorXch } : {};
    const CHUNK = 24;
    for (let i = 0; i < cards.length; i += CHUNK) {
      const ids = cards.slice(i, i + CHUNK).map((c) => c.launcherId);
      try {
        const res = await fetch("/api/binder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids, floors, xchUsdRate: view.xchUsdRate }),
        });
        const data = res.ok ? ((await res.json()) as { nfts?: NftData[] }) : null;
        if (data?.nfts) {
          const byId = new Map(data.nfts.map((n) => [n.launcherId, n]));
          setNfts((prev) => prev.map((n) => byId.get(n.launcherId) ?? n));
        }
      } catch { /* keep fast card */ }
    }
  }, [view.id, view.floorXch, view.xchUsdRate]);

  useEffect(() => {
    const todo = displayed.filter((n) => !enrichedRef.current.has(n.launcherId));
    if (todo.length === 0) return;
    for (const n of todo) enrichedRef.current.add(n.launcherId); // optimistic, prevents double-fetch
    void enrich(todo);
  }, [displayed, enrich]);

  const traitOptions = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const n of nfts) for (const t of n.traits) (map[t.trait_type] ??= new Set()).add(String(t.value));
    const r: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(map)) r[k] = [...v].sort();
    return r;
  }, [nfts]);

  const sidebarProps = {
    tierFilter: tier, onTierFilter: setTier,
    sort, onSort: setSort,
    traitFilters, onTraitFilter: (t: string, v: string) => setTraitFilters((p) => ({ ...p, [t]: v })),
    traitOptions,
    resultCount: filtered.length, totalCount: nfts.length,
    forSaleOnly,
    onForSaleOnly: (v: boolean) => { setForSaleOnly(v); if (v) setSort("deal-desc"); },
    priceMin, priceMax,
    onPriceRange: (min: string, max: string) => { setPriceMin(min); setPriceMax(max); },
    listedCount,
  };

  const moreCount = Math.min(PAGE, filtered.length - displayed.length);

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
            {indexing && <span className="text-violet-300/90 animate-pulse">Finding the rarest across all {view.totalSupply.toLocaleString()}…</span>}
            {fullLoaded && capped && <span className="text-amber-300/90">showing rarest {nfts.length.toLocaleString()}</span>}
          </div>
        </div>
      </div>

      <TierStatsBar collection={SHELL} nfts={nfts} />

      <div className="mx-auto hidden items-start justify-center gap-4 md:flex" style={{ maxWidth: 1320 }}>
        <FilterSidebar {...sidebarProps} />
        <div className="min-w-0 flex-1" style={{ maxWidth: 960 }}>
          <BinderView collection={SHELL} nfts={displayed} hideFullPageLink />
          {displayed.length < filtered.length && (
            <div className="mt-5 flex justify-center">
              <button type="button" onClick={() => setVisible((v) => v + PAGE)}
                className="text-title rounded-lg border border-white/15 bg-white/[0.04] px-6 py-2.5 text-sm font-semibold transition hover:bg-white/[0.08]">
                Show {moreCount} more · {displayed.length.toLocaleString()} of {filtered.length.toLocaleString()}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        <BinderView collection={SHELL} nfts={displayed} hideFullPageLink />
        {displayed.length < filtered.length && (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => setVisible((v) => v + PAGE)}
              className="text-title rounded-lg border border-white/15 bg-white/[0.04] px-6 py-2.5 text-sm font-semibold">
              Show more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
