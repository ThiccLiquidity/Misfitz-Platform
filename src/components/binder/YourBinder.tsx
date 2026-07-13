"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CollectionData, NftData } from "@/types";
import { BinderView } from "./BinderView";
import { BinderCollectionPicker } from "./BinderCollectionPicker";
import { TierStatsBar } from "@/components/collection/TierStatsBar";
import { FilterSidebar, type TierFilter, type SortKey, type TraitFilters } from "@/components/collection/FilterSidebar";
import { tierIdForPercentile } from "@/lib/rarity/tiers";
import { formatUsd, formatXch } from "@/lib/format";
import type { MyHoldings } from "@/lib/portfolio/myHoldings";
import { useHiddenCollections } from "@/lib/portfolio/useHiddenCollections";
import { WorkingIndicator } from "@/components/status/WorkingIndicator";
import { MobileFilterSheet, MobileFilterButton } from "@/components/collection/MobileFilterSheet";
import { stampValueEntry, type ValueEntry } from "@/lib/valuation/valueEntry";
import { FreshnessBadge } from "@/components/common/FreshnessBadge";

const SHELL: CollectionData = {
  slug: "my-binder", name: "Your Binder", description: null, bannerUrl: null, iconUrl: null,
  nftCount: 0, totalSupply: 0, theme: { accent: "#8b5cf6" }, dexieCollectionId: null,
};

function pct(n: NftData): number {
  return n.rarityRank && n.totalSupply ? (n.rarityRank / n.totalSupply) * 100 : 101;
}
function tokenNum(n: NftData): number {
  const m = n.name.match(/#?(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

// Portfolio-appropriate sorts only — the holdings aren't for sale, so marketplace sorts
// (best deals, price) don't apply.
const BINDER_SORTS: { value: SortKey; label: string }[] = [
  { value: "value-desc", label: "Top value" },
  { value: "rank-asc",   label: "Rarest first" },
  { value: "rank-desc",  label: "Most common first" },
  { value: "token-asc",  label: "Token # up" },
  { value: "token-desc", label: "Token # down" },
];

const ENRICH_CAP = 1000; // max cards enriched per view/selection — bounds a whale's per-open detail fetches

export function YourBinder({ holdings }: { holdings: MyHoldings }) {
  const [collectionId, setCollectionId] = useState<string>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("value-desc");
  const [traitFilters, setTraitFilters] = useState<TraitFilters>({});
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const { hidden, toggle: toggleHidden, clear: clearHidden } = useHiddenCollections();

  // Progressive loading: the page hands us a FAST binder (list + per-collection metadata). Once
  // mounted we pull the FULL holdings (per-NFT traits + our estimated ranks + refined values) from
  // the enrichment route and merge them in by NFT id, so cards sharpen up after they're on screen.
  const [nfts, setNfts] = useState<NftData[]>(holdings.nfts);
  const [enriching, setEnriching] = useState(!holdings.demo && holdings.addresses.length > 0);
  const [progress, setProgress] = useState(0);
  const [warming, setWarming] = useState<boolean>(!!holdings.warming);
  const [collections, setCollections] = useState(holdings.collections);
  const [truncated, setTruncated] = useState(holdings.truncated);
  const nftsRef = useRef<NftData[]>(holdings.nfts);
  nftsRef.current = nfts;
  const enrichedRef = useRef<Set<string>>(new Set()); // launcherIds already enriched this session (dedupe on-demand enrichment)
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [valuesAsOf, setValuesAsOf] = useState<number | null>(null);

  // Whale wallets can't be fully paged inside one serverless call, so the page SSRs a first batch with
  // warming=true. Poll the resume endpoint until the full roster lands, growing the card set + collections
  // as pages arrive. Enrichment (below) is held off until this completes so we enrich the FULL set once.
  useEffect(() => {
    if (!warming || holdings.addresses.length === 0) return;
    let cancelled = false;
    (async () => {
      let attempts = 0;
      let fails = 0;
      while (!cancelled && attempts < 60 && fails < 6) {
        await new Promise((r) => setTimeout(r, 3500));
        if (cancelled) return;
        attempts += 1;
        try {
          const res = await fetch("/api/holdings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ addresses: holdings.addresses }),
          });
          if (!res.ok) { fails += 1; continue; }
          fails = 0;
          const data = (await res.json()) as MyHoldings;
          if (cancelled) return;
          if (Array.isArray(data.nfts)) { setNfts(data.nfts); nftsRef.current = data.nfts; }
          if (Array.isArray(data.collections)) setCollections(data.collections);
          setTruncated(data.truncated);
          if (!data.warming) { setWarming(false); return; }
        } catch { fails += 1; }
      }
      // Cap hit or repeated failures: stop warming so enrichment runs on whatever loaded (graceful degrade).
      if (!cancelled) setWarming(false);
    })();
    return () => { cancelled = true; };
  }, [warming, holdings.addresses]);

  useEffect(() => {
    if (holdings.demo || holdings.addresses.length === 0 || warming) return;
    let cancelled = false;
    const all = nftsRef.current;

    // Seeded/authoritative cards already carry a real rank (rankEstimated === false) AND their traits from
    // the bundled seed — MintGarden has nothing to add for them, so enriching them just fires slow detail
    // fetches (and wakes the heavy comps build) for no gain. Skip them: a Misfitz-only wallet needs ZERO
    // enrichment and never shows the spinner. Only cards still missing real traits/ranks get enriched.
    const oneCol = collectionId !== "all";
    let pending = all.filter((n) => !(n.rankEstimated === false && (n.traits?.length ?? 0) > 0) && !enrichedRef.current.has(n.launcherId));
    // Bound the work: enrich the SELECTED collection's cards, else (in "all") the most valuable first — capped.
    // A 20k whale never fires 20k detail fetches on open; we enrich what's viewed, and each collection enriches
    // on demand (deduped via enrichedRef). Normal wallets (< cap) still fully enrich, unchanged.
    if (oneCol) pending = pending.filter((n) => n.collectionSlug === collectionId);
    else pending = [...pending].sort((a, b) => (b.fairValue?.totalEstimate ?? 0) - (a.fairValue?.totalEstimate ?? 0));
    pending = pending.slice(0, ENRICH_CAP);
    const total = pending.length;
    if (total === 0) { setEnriching(false); setProgress(1); return; }

    // Reuse the floor the fast pass already resolved per collection so values stay stable while
    // traits + estimated ranks fill in (only the rarity premium refines).
    const floors: Record<string, number> = {};
    for (const n of all) {
      if (n.fairValue && !(n.collectionSlug in floors)) floors[n.collectionSlug] = n.fairValue.floorValue;
    }

    const CHUNK = 24;
    const chunks: string[][] = [];
    for (let i = 0; i < pending.length; i += CHUNK) chunks.push(pending.slice(i, i + CHUNK).map((n) => n.launcherId));

    setEnriching(true);
    setProgress(0);
    const postChunk = async (ids: string[]): Promise<{ nfts?: NftData[] } | null> => {
      const res = await fetch("/api/binder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, floors, xchUsdRate: holdings.xchUsdRate }),
      });
      return res.ok ? ((await res.json()) as { nfts?: NftData[] }) : null;
    };
    const applyChunk = (data: { nfts?: NftData[] } | null, unranked: Set<string>) => {
      if (!data?.nfts || cancelled) return;
      const byId = new Map(data.nfts.map((n) => [n.launcherId, n]));
      setNfts((prev) => prev.map((n) => byId.get(n.launcherId) ?? n));
      for (const n of data.nfts) {
        if (n.valueBasis != null || !n.collectionSlug?.startsWith("col1")) enrichedRef.current.add(n.launcherId);
        // Re-ask cards still missing a rank OR still on the pre-comps baseline (valueBasis null): the comps
        // model may be building in the background, so retrying lets the portfolio value converge to the same
        // comps value the collection page shows, instead of being stuck on floor + rarity premium.
        if (n.collectionSlug?.startsWith("col1") && (n.rarityRank == null || n.valueBasis == null)) unranked.add(n.launcherId);
        else unranked.delete(n.launcherId);
      }
    };
    (async () => {
      let done = 0;
      const unranked = new Set<string>();
      for (const ids of chunks) {
        if (cancelled) return;
        try { applyChunk(await postChunk(ids), unranked); } catch { /* keep fast card on failure */ }
        done += ids.length;
        if (!cancelled) setProgress(Math.min(1, done / total));
      }
      // Converge any cards still on the baseline via the CHEAP value-index endpoint — one lookup per
      // collection (no per-NFT re-enrichment), which also kicks the shared cold build for not-yet-indexed
      // collections. Stamps browse-identical values as they land. Replaces the old expensive /api/binder retry.
      for (let attempt = 0; attempt < 15 && unranked.size > 0 && !cancelled; attempt++) {
        await new Promise((r) => setTimeout(r, Math.min(30_000, 4_000 * 1.5 ** attempt)));
        if (cancelled) break;
        const byCol: Record<string, string[]> = {};
        const cardCol = new Map(nftsRef.current.map((n) => [n.launcherId, n.collectionSlug]));
        for (const id of unranked) { const c = cardCol.get(id); if (c?.startsWith("col1")) (byCol[c] ??= []).push(id); }
        if (Object.keys(byCol).length === 0) break;
        try {
          const res = await fetch("/api/values", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cols: byCol }) });
          if (!res.ok) continue;
          const data = (await res.json()) as { values?: Record<string, ValueEntry>; asOf?: number | null };
          if (data.asOf) setValuesAsOf((prev) => (prev == null || data.asOf! > prev ? data.asOf! : prev));
          if (cancelled) return;
          const vals = data.values ?? {};
          const gotIds = Object.keys(vals);
          if (gotIds.length) {
            setNfts((prev) => prev.map((n) => {
              const e = vals[n.launcherId];
              if (!e) return n;
              const c = { ...n };
              stampValueEntry(c, e, holdings.xchUsdRate);
              return c;
            }));
            for (const id of gotIds) { unranked.delete(id); enrichedRef.current.add(id); }
          }
        } catch { /* transient — poll again */ }
      }
      if (!cancelled) setEnriching(false);
    })();

    return () => { cancelled = true; };
  }, [warming, collectionId, refreshTick, holdings.addresses, holdings.demo, holdings.xchUsdRate]);

  const oneCollection = collectionId !== "all";

  // Collections the collector hid drop out of the aggregate view, totals, stats, and counts.
  const visibleNfts = useMemo(() => nfts.filter((n) => !hidden.has(n.collectionSlug)), [nfts, hidden]);
  const visibleCollections = useMemo(
    () => collections.filter((c) => !hidden.has(c.id)),
    [collections, hidden],
  );

  // If the collection in focus gets hidden, fall back to the All view.
  useEffect(() => {
    if (collectionId !== "all" && hidden.has(collectionId)) setCollectionId("all");
  }, [hidden, collectionId]);

  // Force-refresh: re-page the wallet from MintGarden NOW (bypasses the 30-min holdings cache) so a
  // just-bought NFT shows immediately. Re-runs enrichment on the fresh set via refreshTick.
  const doRefresh = async () => {
    if (refreshing || holdings.addresses.length === 0) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: holdings.addresses, refresh: true }),
      });
      if (res.ok) {
        const data = (await res.json()) as MyHoldings;
        if (Array.isArray(data.nfts)) { setNfts(data.nfts); nftsRef.current = data.nfts; }
        if (Array.isArray(data.collections)) setCollections(data.collections);
        setTruncated(data.truncated);
        if (data.warming) setWarming(true); // whale: hand off to the resume poll loop
        setRefreshTick((t) => t + 1); // re-run enrichment for any newly-added cards
      }
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  };

  function pickCollection(id: string) {
    setCollectionId(id);
    setTraitFilters({});
    setTier("all");
  }

  const scoped = useMemo(
    () => (oneCollection ? visibleNfts.filter((n) => n.collectionSlug === collectionId) : visibleNfts),
    [visibleNfts, collectionId, oneCollection],
  );

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
      case "value-desc": s.sort((a, b) => (b.fairValue?.totalEstimate ?? 0) - (a.fairValue?.totalEstimate ?? 0)); break;
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
  // Floor value = what the holdings would fetch at each collection's floor (n.fairValue.floorValue).
  const floorValue = useMemo(
    () => Math.round(filtered.reduce((s, n) => s + (n.fairValue?.floorValue ?? 0), 0) * 100) / 100,
    [filtered],
  );

  const sidebarProps = {
    tierFilter: tier, onTierFilter: setTier,
    sort, onSort: setSort,
    sortOptions: BINDER_SORTS,
    traitFilters, onTraitFilter: (t: string, v: string) => setTraitFilters((p) => ({ ...p, [t]: v })),
    traitOptions,
    resultCount: filtered.length, totalCount: scoped.length,
    hideTraits: !oneCollection,
  };

  const activeFilterCount = (tier !== "all" ? 1 : 0) + Object.values(traitFilters).filter((v) => v !== "").length;
  const binderKey = `${collectionId}|${tier}|${sort}|${JSON.stringify(traitFilters)}`;

  return (
    <div>
      <WorkingIndicator active={warming || enriching} label={warming ? `Loading your collection… ${nfts.length.toLocaleString()} so far` : "Reading wallet & refining rarity"} progress={warming ? undefined : progress} />
      {holdings.demo && (
        <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-400">
          Demo binder (seeded Misfitz) — sign in or paste an address to see your real collection.
        </p>
      )}

      {/* Full-width value header */}
      <div className="mb-4 flex flex-col items-center gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] px-6 py-6 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-start sm:gap-x-10 sm:gap-y-4">
          {/* Floor value — what it'd fetch at each collection's floor */}
          <div>
            <div className="text-subtle text-xs uppercase tracking-widest">Floor value</div>
            <div className="text-title mt-1 text-3xl font-black">{formatXch(floorValue)}</div>
            <div className="text-subtle text-sm">≈ {formatUsd(Math.round(floorValue * holdings.xchUsdRate * 100) / 100)}</div>
          </div>
          {/* Traitfolio value — our trait-aware estimate (the headline number) */}
          <div>
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Traitfolio value</div>
            <div className="mt-1 text-4xl font-black" style={{ color: "var(--gold)" }}>{formatXch(shownValue)}</div>
            <div className="text-subtle text-sm">≈ {formatUsd(Math.round(shownValue * holdings.xchUsdRate * 100) / 100)}</div>
            <div className="text-subtle mt-0.5 text-[10px]">Estimate — not a guaranteed price</div>
          </div>
        </div>
        <div className="text-center sm:text-right">
          <div className="text-title text-2xl font-bold">{filtered.length}</div>
          <div className="text-subtle text-xs uppercase tracking-widest">NFTs</div>
          <div className="text-subtle mt-1 text-xs">
            {visibleCollections.length} collection{visibleCollections.length === 1 ? "" : "s"}{warming ? " · loading…" : truncated ? " · capped at 25,000" : ""}
          </div>
          <button type="button" onClick={doRefresh} disabled={refreshing}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-subtle transition hover:bg-white/[0.1] disabled:opacity-50"
            title="Re-check your wallet for new NFTs (skips the cache)">
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
          {!warming && !enriching && valuesAsOf != null && (
            <div className="mt-1.5 flex justify-center sm:justify-end"><FreshnessBadge asOf={valuesAsOf} /></div>
          )}
        </div>
      </div>


      {/* Full-width tier stats bar */}
      <TierStatsBar collection={SHELL} nfts={scoped} />

      {/* Desktop: filters · binder · collections */}
      <div className="mx-auto hidden items-start justify-center gap-4 md:flex" style={{ maxWidth: 1440 }}>
        <FilterSidebar {...sidebarProps} />
        <div className="min-w-0 flex-1" style={{ maxWidth: 880 }}>
          <BinderView key={binderKey} collection={SHELL} nfts={filtered} hideFullPageLink fromPortfolio />
        </div>
        <BinderCollectionPicker
          collections={collections}
          totalCount={visibleNfts.length}
          selectedId={collectionId}
          onSelect={pickCollection}
          hiddenIds={hidden}
          onToggleHide={toggleHidden}
        />
      </div>

      {/* Mobile: collection picker + Filters button (sort/tier/traits live in the sheet), then binder */}
      <div className="flex flex-col gap-2 md:hidden">
        <div className="flex gap-2">
          <select
            value={collectionId}
            onChange={(e) => pickCollection(e.target.value)}
            className="text-title min-w-0 flex-1 rounded-lg border border-white/15 bg-card-bg px-3 text-xs font-semibold outline-none"
            style={{ minHeight: 40 }}
          >
            <option value="all">All collections ({visibleNfts.length})</option>
            {visibleCollections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
            ))}
          </select>
          <MobileFilterButton onClick={() => setFilterSheetOpen(true)} activeCount={activeFilterCount} />
        </div>
        {hidden.size > 0 && (
          <button
            type="button"
            onClick={clearHidden}
            className="self-start text-[11px] font-semibold text-violet-300/90 underline"
          >
            {hidden.size} hidden — show all
          </button>
        )}
        <BinderView key={`m-${binderKey}`} collection={SHELL} nfts={filtered} hideFullPageLink fromPortfolio />
      </div>

      {/* Mobile filter sheet — tier + traits + sort (same FilterSidebar as desktop, in a bottom sheet) */}
      <MobileFilterSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)}>
        <FilterSidebar {...sidebarProps} sheet />
      </MobileFilterSheet>
    </div>
  );
}
