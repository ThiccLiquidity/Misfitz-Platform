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
import { PpLogo } from "@/components/tang/PpLogo";
import { isTangEnabled, walletPeelPoints, TANG_DISCORD_URL } from "@/lib/tang/tang";
import { stampValueEntry, type ValueEntry } from "@/lib/valuation/valueEntry";
import { FreshnessBadge } from "@/components/common/FreshnessBadge";

const SHELL: CollectionData = {
  slug: "my-binder", name: "Your Binder", description: null, bannerUrl: null, iconUrl: null,
  nftCount: 0, totalSupply: 0, theme: { accent: "" }, dexieCollectionId: null,
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
  const [stoppedEarly, setStoppedEarly] = useState(false);
  useEffect(() => { if (warming) setStoppedEarly(false); }, [warming]);
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
            // offset = how many cards we already have: the server sends only the tail, keeping a 10k-card
            // roster under Vercel's response cap so the poll can actually finish.
            body: JSON.stringify({ addresses: holdings.addresses, offset: nftsRef.current.length }),
          });
          if (!res.ok) { fails += 1; continue; }
          fails = 0;
          const data = (await res.json()) as MyHoldings;
          if (cancelled) return;
          // The server sends only NEW cards (delta). Append the ones we don't already have (dedupe by
          // launcherId). The roster grows while warming and never shrinks; totals/collections come whole below.
          if (Array.isArray(data.nfts) && data.nfts.length > 0) {
            const have = new Set(nftsRef.current.map((n) => n.launcherId));
            const merged = [...nftsRef.current, ...data.nfts.filter((n) => !have.has(n.launcherId))];
            setNfts(merged); nftsRef.current = merged;
          }
          if (Array.isArray(data.collections)) setCollections(data.collections);
          setTruncated(data.truncated);
          if (!data.warming) { setWarming(false); return; }
        } catch { fails += 1; }
      }
      // Cap hit or repeated failures: show the honest "partial — sync incomplete" state (not a clean, possibly
      // empty binder) and stop warming so enrichment runs on whatever loaded. Refresh resumes from the checkpoint.
      if (!cancelled) { setStoppedEarly(true); setWarming(false); }
    })();
    return () => { cancelled = true; };
  }, [warming, holdings.addresses]);

  useEffect(() => {
    // NOTE: stoppedEarly must NOT gate this effect. "Stop" only halts the roster paging (warming poll);
    // the cards already loaded still need traits/ranks/values, which is exactly what this effect provides.
    if (holdings.demo || holdings.addresses.length === 0 || warming) return;
    let cancelled = false;
    const all = nftsRef.current;

    // Seeded/authoritative cards already carry a real rank (rankEstimated === false) AND their traits from
    // the bundled seed — MintGarden has nothing to add for them, so enriching them just fires slow detail
    // fetches (and wakes the heavy comps build) for no gain. Skip them: a Misfitz-only wallet needs ZERO
    // enrichment and never shows the spinner. Only cards still missing real traits/ranks get enriched.
    const oneCol = collectionId !== "all";
    // A card with BOTH a rank AND traits is fully enriched — from the SSR artifact stamp (warm collections'
    // cached roster + value index) or a prior /api/binder round-trip — so skip it. Cards with traits but no
    // rank (DID inline traits, unranked collection) still need OUR estimated rank. Cold collections (no
    // cached roster) have no traits yet -> enriched here via /api/binder as the fallback path.
    let pending = all.filter((n) => !(n.rarityRank != null && (n.traits?.length ?? 0) > 0) && !enrichedRef.current.has(n.launcherId));
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
      // ── Value convergence — runs in PARALLEL with enrichment, not after it ────────────────────
      // Seeded from EVERY held col1 card still missing an index-stamped value, so cards MintGarden
      // drops from enrichment (429) still converge, and a warm value index lands values in ~1s. Each
      // poll is one cheap lookup per collection; a not-yet-indexed collection gets the shared build
      // kicked server-side and we poll again. Attempt 0 fires immediately (no wait).
      const needsValue = new Set<string>(
        all.filter((n) => n.collectionSlug?.startsWith("col1") && n.valueBasis == null).map((n) => n.launcherId),
      );
      const converge = (async () => {
        for (let attempt = 0; attempt < 20 && needsValue.size > 0 && !cancelled; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(20_000, 1_500 * 1.5 ** attempt)));
          if (cancelled) break;
          const byCol: Record<string, string[]> = {};
          const cardCol = new Map(nftsRef.current.map((n) => [n.launcherId, n.collectionSlug]));
          for (const id of needsValue) { const c = cardCol.get(id); if (c?.startsWith("col1")) (byCol[c] ??= []).push(id); }
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
              // A value is NOT traits: stampValueEntry never fills card.traits, so marking these ids
              // "enriched" here would make the trait-pending filter skip them forever. Only applyChunk
              // (proof the /api/binder detail round-trip succeeded) may add to enrichedRef.
              for (const id of gotIds) needsValue.delete(id);
            }
          } catch { /* transient — poll again */ }
        }
      })();

      // ── Trait/rank enrichment (chunked /api/binder) ───────────────────────────────────────────
      let done = 0;
      const posted = new Set<string>();
      const returned = new Set<string>();
      for (const ids of chunks) {
        if (cancelled) return;
        for (const id of ids) posted.add(id);
        try {
          const data = await postChunk(ids);
          for (const n of data?.nfts ?? []) returned.add(n.launcherId);
          applyChunk(data, needsValue);
        } catch { /* keep fast card on failure */ }
        done += ids.length;
        if (!cancelled) setProgress(Math.min(1, done / total));
      }
      // ONE bounded second pass for ids MintGarden dropped (429/timeout) so a rate-limit blip can't
      // leave permanent trait holes for the rest of the session. 1.5s lets the fg 429 cooldown clear.
      const missing = [...posted].filter((id) => !returned.has(id));
      if (missing.length > 0 && !cancelled) {
        await new Promise((r) => setTimeout(r, 1_500));
        for (let i = 0; i < missing.length && !cancelled; i += CHUNK) {
          try { applyChunk(await postChunk(missing.slice(i, i + CHUNK)), needsValue); } catch { /* leave fast card */ }
        }
      }
      // Traits + ranks are in — stop the indicator NOW. Values keep refining silently via the parallel
      // converge poll above; the indicator no longer rides that multi-minute value tail.
      if (!cancelled) { setProgress(1); setEnriching(false); }
      await converge;
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
  // Weekly peel-point estimate for the whole wallet (per-NFT, Tang Gang collections + special NFTs).
  const peel = useMemo(() => walletPeelPoints(nfts), [nfts]);

  // If the collection in focus gets hidden, fall back to the All view.
  useEffect(() => {
    if (collectionId !== "all" && hidden.has(collectionId)) setCollectionId("all");
  }, [hidden, collectionId]);

  // Force-refresh: re-page the wallet from MintGarden NOW (bypasses the 30-min holdings cache) so a
  // just-bought NFT shows immediately. Re-runs enrichment on the fresh set via refreshTick.
  const doRefresh = async () => {
    if (refreshing || holdings.addresses.length === 0) return;
    setStoppedEarly(false); // a manual refresh re-enables loading after an early stop
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

  const peelPill = isTangEnabled() && peel.total > 0 ? (
    <a href={TANG_DISCORD_URL} target="_blank" rel="noopener noreferrer" title={`Peel Points — tap to open the Tang Gang Discord. Estimated for the weekly snapshot — ${peel.tangNftCount} Tang Gang NFT${peel.tangNftCount === 1 ? "" : "s"}, counted per NFT. Excludes token/CAT balances.`}
      className="inline-flex items-center gap-2 rounded-full border border-orange-600/50 bg-orange-500 px-4 py-2 text-sm font-black text-white shadow-[0_0_18px_rgba(249,115,22,0.35)] transition hover:bg-orange-600">
      <PpLogo size={24} /> {peel.total.toLocaleString()} Peel Points
    </a>
  ) : null;
  return (
    <div>
      <WorkingIndicator active={warming || enriching} label={warming ? `Loading your collection… ${nfts.length.toLocaleString()} so far` : "Reading wallet & refining rarity"} progress={warming ? undefined : progress} />
      {holdings.demo && (
        <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-400">
          Demo binder (seeded Misfitz) — sign in or paste an address to see your real collection.
        </p>
      )}

      {/* Value header — one hero card */}
      <div className="relative mb-4 overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--card-border)_25%,transparent)] bg-card-bg px-5 py-4 sm:px-6 sm:py-5">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.07] via-transparent to-transparent" />
        <div className="relative">
          {/* top row: eyebrow · refresh. Peel pill sits in the cluster on desktop, centers below on mobile. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h1 className="text-subtle text-[11px] font-bold uppercase tracking-[0.2em]">Your Binder</h1>
              {holdings.addresses.length > 0 && (
                <span className="text-subtle text-[11px]">{holdings.addresses.length} wallet{holdings.addresses.length === 1 ? "" : "s"}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {peelPill && <span className="hidden sm:inline-flex">{peelPill}</span>}
              <button type="button" onClick={doRefresh} disabled={refreshing}
                className="inline-flex items-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--card-border)_25%,transparent)] bg-[color-mix(in_srgb,var(--card-border)_6%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-subtle transition hover:bg-[color-mix(in_srgb,var(--card-border)_12%,transparent)] disabled:opacity-50 sm:px-3 sm:py-1.5 sm:text-xs"
                title="Re-check your wallet for new NFTs (skips the cache)">
                {refreshing ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          </div>
          {peelPill && <div className="mt-3 flex justify-center sm:hidden">{peelPill}</div>}

          {/* main row: hero value + floor + stat rail */}
          <div className="mt-4 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end sm:gap-6">
              {/* Traitfolio value — the hero */}
              <div className="relative">
                <div className="pointer-events-none absolute -inset-6 -z-10 rounded-full blur-2xl" style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--gold) 14%, transparent), transparent)" }} />
                <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>Traitfolio value</div>
                <div className="mt-1 text-5xl font-black leading-none tabular-nums sm:text-6xl" style={{ color: "var(--gold)" }}>{formatXch(shownValue)}</div>
                <div className="text-subtle mt-1 text-sm">≈ {formatUsd(Math.round(shownValue * holdings.xchUsdRate * 100) / 100)} <span className="text-[11px]">· Estimate, not a guaranteed price</span></div>
              </div>
              {/* Floor value — subordinate */}
              <div className="border-[color-mix(in_srgb,var(--card-border)_15%,transparent)] pt-3 sm:border-l sm:pt-0 sm:pl-6">
                <div className="text-subtle text-[11px] font-bold uppercase tracking-widest">Floor value</div>
                <div className="text-title mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatXch(floorValue)}</div>
                <div className="text-subtle text-xs">≈ {formatUsd(Math.round(floorValue * holdings.xchUsdRate * 100) / 100)}</div>
              </div>
            </div>
            {/* stat rail */}
            <div className="flex flex-col items-center sm:items-end">
              <div className="flex divide-x divide-[color-mix(in_srgb,var(--card-border)_15%,transparent)]">
                <div className="px-4 text-center"><div className="text-title text-2xl font-black tabular-nums">{filtered.length.toLocaleString()}</div><div className="text-subtle text-[10px] uppercase tracking-widest">NFTs</div></div>
                <div className="px-4 text-center"><div className="text-title text-2xl font-black tabular-nums">{visibleCollections.length}</div><div className="text-subtle text-[10px] uppercase tracking-widest">Collections</div></div>
              </div>
              {(truncated || stoppedEarly) && (
                <div className="text-subtle mt-1 text-[10px]">{stoppedEarly ? "partial — stopped early" : "capped at 25,000"}</div>
              )}
              {!warming && !enriching && valuesAsOf != null && (
                <div className="mt-1 flex justify-center sm:justify-end"><FreshnessBadge asOf={valuesAsOf} /></div>
              )}
            </div>
          </div>

          {/* sync pill — only while the wallet is still loading */}
          {warming && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--card-border)_25%,transparent)] bg-black/20 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-title">
                <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--gold)" }} />
                Syncing wallet · {nfts.length.toLocaleString()} NFTs found…
              </div>
              <button type="button" onClick={() => { setWarming(false); setEnriching(false); setStoppedEarly(true); }} title="Stop syncing — keep what's loaded so far and browse now"
                className="shrink-0 rounded-md border border-[color-mix(in_srgb,var(--card-border)_25%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-subtle transition hover:bg-[color-mix(in_srgb,var(--card-border)_12%,transparent)]">
                Stop
              </button>
            </div>
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
            className="tf-select min-w-0 flex-1 rounded-lg px-3 text-xs font-semibold outline-none"
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
            className="self-start text-[11px] font-semibold text-subtle underline transition hover:text-title"
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
