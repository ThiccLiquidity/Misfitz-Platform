"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { CollectionData, NftData } from "@/types";
import { BinderView } from "@/components/binder/BinderView";
import { TierStatsBar } from "@/components/collection/TierStatsBar";
import { FilterSidebar, type TierFilter, type SortKey, type TraitFilters, type CatFilter } from "@/components/collection/FilterSidebar";
import { MobileFilterSheet, MobileFilterButton } from "@/components/collection/MobileFilterSheet";
import { WorkingIndicator } from "@/components/status/WorkingIndicator";
import { FreshnessBadge } from "@/components/common/FreshnessBadge";
import { tierIdForPercentile } from "@/lib/rarity/tiers";
import { formatXch, formatUsd, formatXchShort, formatUsdShort } from "@/lib/format";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { computeDealScore } from "@/lib/rarity/enrich";
import type { CollectionView } from "@/lib/collections/liveCollection";

const PAGE = 120; // how many cards we render at a time (the rest stay out of the DOM)

function pct(n: NftData): number {
  return n.rarityRank && n.totalSupply ? (n.rarityRank / n.totalSupply) * 100 : 101;
}
function tokenNum(n: NftData): number {
  const m = n.name.match(/#?(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
// A listing is CAT-inclusive when it asks for any non-XCH asset.
function isCatListing(n: NftData): boolean {
  return n.listing != null && (n.listingAssets ?? []).some((a) => a !== "XCH");
}

export function CollectionBinder({ view }: { view: CollectionView }) {
  // Start with the SSR first page (mint order), then swap to the whole collection sorted rarest-first.
  const [nfts, setNfts] = useState<NftData[]>(view.nfts);
  const [hotTraits, setHotTraits] = useState<{ type: string; value: string; ratio: number }[]>([]);
  const { mode: themeMode } = useThemeMode();
  const statLight = themeMode === "light";
  const [fullLoaded, setFullLoaded] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [indexing, setIndexing] = useState(view.totalSupply > view.nfts.length);
  const [warming, setWarming] = useState(false);
  const [valuesAsOf, setValuesAsOf] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank-asc");
  const [traitFilters, setTraitFilters] = useState<TraitFilters>({});
  const [forSaleOnly, setForSaleOnly] = useState(false);
  const prevSortRef = useRef<SortKey>("rank-asc"); // restore the shopper's sort when they leave Best Deals
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [collectorOnly, setCollectorOnly] = useState(false);
  const [collectorTier, setCollectorTier] = useState(4); // keep collectible badges with tier <= this
  const [catFilter, setCatFilter] = useState<CatFilter>("all");
  const [search, setSearch] = useState("");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const SHELL: CollectionData = useMemo(() => ({
    slug: view.id, name: view.name, description: view.description, bannerUrl: view.bannerUrl,
    iconUrl: view.imageUrl, nftCount: nfts.length, totalSupply: view.totalSupply,
    theme: { accent: "#8b5cf6" }, dexieCollectionId: view.id,
  }), [view, nfts.length]);

  // Pull the entire collection (cached server-side), sorted rarest-first. The FIRST load sets the list;
  // while the sales model is still warming we re-poll with BACKOFF and MERGE the refreshed values into the
  // existing cards (never a full replace) — so enriched traits aren't discarded and the grid/filter bar
  // don't churn. Hot-traits only update when they actually change (and never shrink to empty once shown),
  // which is what stops the trending section flickering in and out.
  const firstAllLoadRef = useRef(true);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let lastTotal = 0;
    const hotKey = (h: { type: string; value: string; ratio: number }[]) => h.map((x) => `${x.type}|${x.value}`).join(",");
    const load = () => {
      setIndexing(true);
      fetch(`/api/collection/${view.id}/all`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { nfts?: NftData[]; capped?: boolean; hotTraits?: { type: string; value: string; ratio: number }[]; warming?: boolean; valuesAsOf?: number | null } | null) => {
          if (cancelled) return;
          const nfts = data?.nfts ?? [];
          const reschedule = () => { if (tries < 12) { tries += 1; timer = setTimeout(load, Math.min(60_000, 12_000 * Math.pow(1.7, tries))); } };
          if (nfts.length) {
            if (firstAllLoadRef.current) {
              firstAllLoadRef.current = false;
              setNfts(nfts);
            } else {
              const byId = new Map(nfts.map((n) => [n.launcherId, n]));
              setNfts((prev) => {
                const prevIds = new Set(prev.map((n) => n.launcherId));
                const merged = prev.map((card) => {
                  const fresh = byId.get(card.launcherId);
                  if (!fresh) return card;
                  const newRank = card.rarityRank ?? fresh.rarityRank ?? null;
                  const newTotal = fresh.fairValue?.totalEstimate ?? card.fairValue?.totalEstimate ?? null;
                  const curTotal = card.fairValue?.totalEstimate ?? null;
                  if (newRank === (card.rarityRank ?? null) && newTotal === curTotal && (fresh.valueCurve ?? null) === (card.valueCurve ?? null)) {
                    return card;
                  }
                  return {
                    ...card,
                    rarityRank: newRank,
                    rankEstimated: card.rarityRank != null ? card.rankEstimated : fresh.rankEstimated,
                    fairValue: fresh.fairValue ?? card.fairValue,
                    valueBasis: fresh.valueBasis ?? card.valueBasis,
                    valueConfidence: fresh.valueConfidence ?? card.valueConfidence,
                    valueCurve: fresh.valueCurve ?? card.valueCurve,
                    valueTraitMult: fresh.valueTraitMult ?? card.valueTraitMult,
                    valueTraitTop: fresh.valueTraitTop ?? card.valueTraitTop,
                  };
                });
                const appended = nfts.filter((n) => !prevIds.has(n.launcherId)); // new cards from a fuller (resumed) scan
                return appended.length ? [...merged, ...appended] : merged;
              });
            }
            setCapped(Boolean(data?.capped));
            if (data?.hotTraits && data.hotTraits.length > 0) {
              setHotTraits((prev) => (hotKey(prev) === hotKey(data.hotTraits!) ? prev : data.hotTraits!));
            }
            setFullLoaded(true);
            if (data?.valuesAsOf) setValuesAsOf(data.valuesAsOf);
            if (nfts.length > lastTotal) { lastTotal = nfts.length; tries = 0; } // grew -> reset backoff, keep polling
          }
          // Keep polling while the server is warming OR we got nothing yet (roster still scanning / lock-loser empty).
          const stillWarming = !data || data.warming === true || nfts.length === 0;
          setWarming(stillWarming);
          if (stillWarming) reschedule();
        })
        .catch(() => { if (!cancelled && tries < 12) { tries += 1; timer = setTimeout(load, Math.min(60_000, 12_000 * Math.pow(1.7, tries))); } })
        .finally(() => { if (!cancelled) setIndexing(false); });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [view.id]);

  // ── Filtering + sorting over the WHOLE collection, then render only the visible slice ──
  const filtered = useMemo(() => {
    const minP = parseFloat(priceMin);
    const maxP = parseFloat(priceMax);
    const hasPrice = Number.isFinite(minP) || Number.isFinite(maxP);

    let r = nfts;

    // Search by token #number or (partial) launcher id / name.
    const q = search.trim().toLowerCase().replace(/^#/, "");
    if (q) {
      r = r.filter((n) => {
        if (n.launcherId.toLowerCase().includes(q)) return true;
        if (/^\d+$/.test(q) && String(tokenNum(n)) === q) return true;
        return n.name.toLowerCase().includes(q);
      });
    }

    if (tier !== "all") r = r.filter((n) => (n.rarityRank ? tierIdForPercentile(pct(n)) === tier : false));
    const activeTraits = Object.entries(traitFilters).filter(([, v]) => v !== "");
    if (activeTraits.length) {
      r = r.filter((n) => activeTraits.every(([t, v]) => n.traits.some((tr) => tr.trait_type === t && String(tr.value) === v)));
    }
    // CAT-offer visibility: hide CAT-inclusive listings, or show only those.
    if (catFilter === "only") r = r.filter((n) => isCatListing(n));
    else if (catFilter === "hide") r = r.filter((n) => !isCatListing(n));
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

    // Collector numbers (numerology): keep only special mint numbers at/above the chosen strength.
    if (collectorOnly) r = r.filter((n) => n.collectible != null && n.collectible.tier <= collectorTier);

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
  }, [nfts, tier, traitFilters, sort, forSaleOnly, priceMin, priceMax, collectorOnly, collectorTier, catFilter, search]);

  const listedCount = useMemo(() => nfts.reduce((c, n) => c + (n.listing ? 1 : 0), 0), [nfts]);
  const catCount = useMemo(() => nfts.reduce((c, n) => c + (isCatListing(n) ? 1 : 0), 0), [nfts]);
  // Market cap (industry standard) = floor × supply. Traitfolio cap = sum of our estimates, scaled to
  // full supply when the load is capped, for a more realistic second number.
  const marketCap = useMemo(
    () => (view.floorXch != null ? view.floorXch * view.totalSupply : null),
    [view.floorXch, view.totalSupply],
  );
  const traitfolioCap = useMemo(() => {
    const sum = nfts.reduce((s, n) => s + (n.fairValue?.totalEstimate ?? 0), 0);
    if (sum <= 0 || nfts.length === 0) return null;
    const scale = nfts.length < view.totalSupply ? view.totalSupply / nfts.length : 1;
    return Math.round(sum * scale);
  }, [nfts, view.totalSupply]);
  const collectorCount = useMemo(
    () => nfts.reduce((c, n) => c + (n.collectible != null && n.collectible.tier <= collectorTier ? 1 : 0), 0),
    [nfts, collectorTier],
  );

  const displayed = useMemo(() => filtered.slice(0, visible), [filtered, visible]);

  // Reset the window when the filter/sort changes so you always see the top of the new order.
  useEffect(() => { setVisible(PAGE); }, [tier, sort, traitFilters, forSaleOnly, priceMin, priceMax, collectorOnly, collectorTier, catFilter, search]);

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
        // Any id that didn't come back (failed detail fetch) is un-marked so it retries later.
        const returned = new Set((data?.nfts ?? []).map((n) => n.launcherId));
        for (const id of ids) if (!returned.has(id)) enrichedRef.current.delete(id);
        if (data?.nfts) {
          const byId = new Map(data.nfts.map((n) => [n.launcherId, n]));
          // Take traits/rank/value from enrichment, but KEEP the Dexie-verified listing + deal from the
          // full-collection overlay (enrichment maps listing from MintGarden, which would revert it).
          setNfts((prev) => prev.map((n) => {
            const e = byId.get(n.launcherId);
            if (!e) return n;
            // The enriched card (e) now carries TRAIT-AWARE comps (value + basis); prefer it. Fall back to
            // the grid's rank-only comps (n) only if enrichment didn't produce one. Always keep the
            // Dexie-verified listing/terms from the full-collection overlay (n).
            const comps = e.valueBasis
              ? {} // keep e's comps fairValue/valueBasis/valueConfidence (already spread from ...e)
              : (n.valueBasis ? { fairValue: n.fairValue, valueBasis: n.valueBasis, valueConfidence: n.valueConfidence } : {});
            const merged = { ...e, ...comps, listing: n.listing, listingAssets: n.listingAssets, listingRequested: n.listingRequested, dexieOfferId: n.dexieOfferId, listingUnverified: n.listingUnverified };
            // Re-score the deal against the displayed (comps-blended) value, clean single-NFT XCH only.
            const xchOnly = !!n.listingRequested && n.listingRequested.length === 1 && n.listingRequested[0].code === "XCH";
            const dealScore = n.listing && n.dexieOfferId && xchOnly && n.listing.priceXch > 0 && merged.fairValue
              ? computeDealScore(merged.fairValue.totalEstimate, n.listing.priceXch)
              : n.dealScore;
            return { ...merged, dealScore };
          }));
        }
      } catch { for (const id of ids) enrichedRef.current.delete(id); /* allow retry */ }
    }
  }, [view.id, view.floorXch, view.xchUsdRate]);

  useEffect(() => {
    const todo = displayed.filter((n) => !enrichedRef.current.has(n.launcherId));
    if (todo.length === 0) return;
    for (const n of todo) enrichedRef.current.add(n.launcherId); // optimistic, prevents double-fetch
    setEnriching(true);
    void enrich(todo).finally(() => setEnriching(false));
  }, [displayed, enrich]);

  const traitOptions = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const n of nfts) for (const t of n.traits) (map[t.trait_type] ??= new Set()).add(String(t.value));
    const r: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(map)) r[k] = [...v].sort();
    return r;
  }, [nfts]);

  const hotTraitKeys = useMemo(() => new Set(hotTraits.map((h) => `${h.type}|${h.value}`)), [hotTraits]);

  // Map the (lowercased) hot traits back to the real-cased type/value present in the options so a click
  // applies the exact filter. Keep the strongest handful for a compact, obvious trending row.
  const trendingTraits = useMemo(() => {
    const out: { traitType: string; value: string; ratio: number }[] = [];
    for (const h of hotTraits) {
      let match: { traitType: string; value: string } | null = null;
      for (const [tt, vals] of Object.entries(traitOptions)) {
        if (tt.toLowerCase() !== h.type) continue;
        const v = vals.find((x) => x.toLowerCase() === h.value);
        if (v) { match = { traitType: tt, value: v }; break; }
      }
      if (match) out.push({ ...match, ratio: h.ratio });
    }
    return out.slice(0, 8);
  }, [hotTraits, traitOptions]);

  const activeFilterCount =
    (tier !== "all" ? 1 : 0) +
    Object.values(traitFilters).filter((v) => v !== "").length +
    (forSaleOnly ? 1 : 0) + (collectorOnly ? 1 : 0) + (priceMin || priceMax ? 1 : 0) +
    (catFilter !== "all" ? 1 : 0) + (search.trim() ? 1 : 0);
  const sidebarProps = {
    tierFilter: tier, onTierFilter: setTier,
    sort, onSort: setSort,
    traitFilters, onTraitFilter: (t: string, v: string) => setTraitFilters((p) => ({ ...p, [t]: v })),
    traitOptions,
    hotTraitKeys,
    trendingTraits,
    resultCount: filtered.length, totalCount: nfts.length,
    searchQuery: search, onSearch: setSearch,
    forSaleOnly,
    onForSaleOnly: (v: boolean) => { setForSaleOnly(v); if (v) setSort("deal-desc"); },
    priceMin, priceMax,
    onPriceRange: (min: string, max: string) => { setPriceMin(min); setPriceMax(max); },
    listedCount,
    catFilter, onCatFilter: setCatFilter, catCount,
    collectorOnly, onCollectorOnly: setCollectorOnly,
    collectorTier, onCollectorTier: setCollectorTier,
    collectorCount,
  };

  const moreCount = Math.min(PAGE, filtered.length - displayed.length);
  // Remounts the binder (resets its grid page) when the FILTER changes, not on enrichment polls / Show more.
  const filterKey = `${tier}|${sort}|${JSON.stringify(traitFilters)}|${forSaleOnly}|${priceMin}|${priceMax}|${collectorOnly}|${collectorTier}|${catFilter}|${search}`;

  // Best Deals pill (rendered centered over the binder spread on both breakpoints, below).
  const bestDealsOn = forSaleOnly && sort === "deal-desc";
  const toggleBestDeals = () => {
    if (bestDealsOn) { setForSaleOnly(false); setSort(prevSortRef.current ?? "rank-asc"); }
    else { prevSortRef.current = sort; setForSaleOnly(true); setSort("deal-desc"); }
  };
  const bestDealsPill = (
    <div className="mb-3 flex justify-center">
      <style>{`@keyframes bd-glow{0%,100%{box-shadow:0 4px 14px rgba(0,0,0,0.35)}50%{box-shadow:0 0 24px 5px rgba(34,197,94,0.6),0 4px 14px rgba(0,0,0,0.35)}}`}</style>
      <button
        type="button"
        onClick={toggleBestDeals}
        aria-pressed={bestDealsOn}
        className="group relative inline-flex items-center gap-2.5 rounded-full px-7 py-3 text-base font-black uppercase tracking-wide text-white transition-transform duration-150 hover:scale-[1.04] active:scale-95"
        style={{
          background: bestDealsOn
            ? "linear-gradient(90deg,#16a34a,#22c55e 55%,#f0c040)"
            : "linear-gradient(90deg,#1f8f47,#2fae5e 55%,#c99a2e)",
          animation: "bd-glow 2.2s ease-in-out infinite",
        }}
      >
        <span className="text-lg leading-none">{bestDealsOn ? "✅" : "🔥"}</span>
        {bestDealsOn ? "Showing Best Deals" : "Best Deals"}
        {listedCount > 0 && (
          <span className="rounded-full bg-black/25 px-2 py-0.5 text-xs font-bold tabular-nums">{listedCount} listed</span>
        )}
      </button>
    </div>
  );


  return (
    <div className="py-2">
      <WorkingIndicator
        active={indexing || enriching || warming}
        label={indexing ? "Loading collection…" : enriching ? "Refining rarity & sales…" : "Building sales model…"}
      />
      {/* Collection header */}
      <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
        <div className="flex items-center gap-4">
          {view.imageUrl && (
            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl">
              <Image src={view.imageUrl} alt={view.name} fill className="object-cover" sizes="56px" unoptimized />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="text-title truncate text-2xl font-black">{view.name}</h1>
              {view.verified && <span className="text-sky-400" title="Verified creator">✔</span>}
            </div>
            <div className="text-subtle mt-0.5 text-xs">
              {view.totalSupply.toLocaleString()} items
              {fullLoaded && capped && <span style={{ color: statLight ? "#059669" : "#fcd34d" }}> · showing rarest {nfts.length.toLocaleString()}</span>}
            </div>
            {fullLoaded && !warming && <div className="mt-1.5"><FreshnessBadge asOf={valuesAsOf} light={statLight} /></div>}
          </div>
        </div>

        {/* Big, clear stat strip — XCH headline + USD subline. */}
        <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {([
            { label: "Floor", xch: view.floorXch != null ? formatXch(view.floorXch) : "—",
              usd: view.floorXch != null ? formatUsd(Math.round(view.floorXch * view.xchUsdRate * 100) / 100) : null, accent: undefined },
            { label: "Market cap", xch: marketCap != null ? formatXchShort(marketCap) : "—",
              usd: marketCap != null ? formatUsdShort(marketCap * view.xchUsdRate) : null, accent: undefined },
            { label: "Traitfolio cap", xch: traitfolioCap != null ? formatXchShort(traitfolioCap) : "—",
              usd: traitfolioCap != null ? formatUsdShort(traitfolioCap * view.xchUsdRate) : null, accent: "var(--gold)" },
            { label: "Volume", xch: view.volumeXch != null ? formatXchShort(view.volumeXch) : "—",
              usd: view.volumeXch != null ? formatUsdShort(view.volumeXch * view.xchUsdRate) : null, accent: undefined },
          ] as const).map((st) => (
            <div
              key={st.label}
              className="rounded-xl px-4 py-2.5"
              style={{ background: "rgba(201,162,39,0.06)", border: "1px solid rgba(201,162,39,0.22)" }}
            >
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: statLight ? "#7a5510" : "#e8cf94" }}>{st.label}</div>
              <div className="text-xl font-black leading-tight sm:text-2xl" style={{ color: st.accent ?? "var(--title)" }}>{st.xch}</div>
              {st.usd && <div className="mt-0.5 text-[13px] font-semibold" style={{ color: statLight ? "#6a4d0e" : "#d9c896" }}>{st.usd}</div>}
            </div>
          ))}
        </div>
      </div>


      <TierStatsBar collection={SHELL} nfts={nfts} />

      <div className="mx-auto hidden items-start justify-center gap-4 md:flex" style={{ maxWidth: 1320 }}>
        <FilterSidebar {...sidebarProps} />
        <div className="min-w-0 flex-1" style={{ maxWidth: 960 }}>
          {bestDealsPill}
          <BinderView key={filterKey} collection={SHELL} nfts={displayed} hideFullPageLink onNeedMore={() => setVisible((v) => v + PAGE)} hasMore={visible < filtered.length} />
          {displayed.length < filtered.length && (
            <div className="mt-5 hidden justify-center xl:flex">
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
        <div className="mb-2 flex justify-end px-1">
          <MobileFilterButton onClick={() => setFilterSheetOpen(true)} activeCount={activeFilterCount} />
        </div>
        {bestDealsPill}
        <BinderView key={filterKey} collection={SHELL} nfts={displayed} hideFullPageLink onNeedMore={() => setVisible((v) => v + PAGE)} hasMore={visible < filtered.length} />
        {displayed.length < filtered.length && (
          <div className="mt-4 hidden">
            <button type="button" onClick={() => setVisible((v) => v + PAGE)}
              className="text-title rounded-lg border border-white/15 bg-white/[0.04] px-6 py-2.5 text-sm font-semibold">
              Show more
            </button>
          </div>
        )}
      </div>

      {/* Mobile filter sheet — sort + tier + traits + shop controls (same FilterSidebar as desktop) */}
      <MobileFilterSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)}>
        <FilterSidebar {...sidebarProps} sheet />
      </MobileFilterSheet>
    </div>
  );
}
