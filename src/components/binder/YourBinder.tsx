"use client";

import { useEffect, useMemo, useState } from "react";
import type { CollectionData, NftData } from "@/types";
import { BinderView } from "./BinderView";
import { BinderCollectionPicker } from "./BinderCollectionPicker";
import { TierStatsBar } from "@/components/collection/TierStatsBar";
import { FilterSidebar, type TierFilter, type SortKey, type TraitFilters } from "@/components/collection/FilterSidebar";
import { tierIdForPercentile } from "@/lib/rarity/tiers";
import { formatUsd, formatXch } from "@/lib/format";
import type { MyHoldings } from "@/lib/portfolio/myHoldings";

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

export function YourBinder({ holdings }: { holdings: MyHoldings }) {
  const [collectionId, setCollectionId] = useState<string>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [sort, setSort] = useState<SortKey>("rank-asc");
  const [traitFilters, setTraitFilters] = useState<TraitFilters>({});

  // Progressive loading: the page hands us a FAST binder (list + per-collection metadata). Once
  // mounted we pull the FULL holdings (per-NFT traits + our estimated ranks + refined values) from
  // the enrichment route and merge them in by NFT id, so cards sharpen up after they're on screen.
  const [nfts, setNfts] = useState<NftData[]>(holdings.nfts);
  const [enriching, setEnriching] = useState(!holdings.demo && holdings.addresses.length > 0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (holdings.demo || holdings.addresses.length === 0) return;
    let cancelled = false;
    const all = holdings.nfts;
    const total = all.length;
    if (total === 0) { setEnriching(false); return; }

    // Reuse the floor the fast pass already resolved per collection so values stay stable while
    // traits + estimated ranks fill in (only the rarity premium refines).
    const floors: Record<string, number> = {};
    for (const n of all) {
      if (n.fairValue && !(n.collectionSlug in floors)) floors[n.collectionSlug] = n.fairValue.floorValue;
    }

    const CHUNK = 24;
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK).map((n) => n.launcherId));

    setEnriching(true);
    setProgress(0);
    (async () => {
      let done = 0;
      for (const ids of chunks) {
        if (cancelled) return;
        try {
          const res = await fetch("/api/binder", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids, floors, xchUsdRate: holdings.xchUsdRate }),
          });
          const data = res.ok ? ((await res.json()) as { nfts?: NftData[] }) : null;
          if (data?.nfts && !cancelled) {
            const byId = new Map(data.nfts.map((n) => [n.launcherId, n]));
            setNfts((prev) => prev.map((n) => byId.get(n.launcherId) ?? n));
          }
        } catch { /* keep fast card on failure */ }
        done += ids.length;
        if (!cancelled) setProgress(Math.min(1, done / total));
      }
      if (!cancelled) setEnriching(false);
    })();

    return () => { cancelled = true; };
  }, [holdings.addresses, holdings.demo, holdings.nfts, holdings.xchUsdRate]);

  const oneCollection = collectionId !== "all";

  function pickCollection(id: string) {
    setCollectionId(id);
    setTraitFilters({});
    setTier("all");
  }

  const scoped = useMemo(
    () => (oneCollection ? nfts.filter((n) => n.collectionSlug === collectionId) : nfts),
    [nfts, collectionId, oneCollection],
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
    traitFilters, onTraitFilter: (t: string, v: string) => setTraitFilters((p) => ({ ...p, [t]: v })),
    traitOptions,
    resultCount: filtered.length, totalCount: scoped.length,
    hideTraits: !oneCollection,
  };

  const binderKey = `${collectionId}|${tier}|${sort}|${JSON.stringify(traitFilters)}`;

  return (
    <div>
      {holdings.demo && (
        <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-400">
          Demo binder (seeded Misfitz) — sign in or paste an address to see your real collection.
        </p>
      )}

      {/* Full-width value header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] px-6 py-6">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          {/* Floor value — what it'd fetch at each collection's floor */}
          <div>
            <div className="text-subtle text-xs uppercase tracking-widest">Floor value</div>
            <div className="text-title mt-1 text-3xl font-black">{formatXch(floorValue)}</div>
            <div className="text-subtle text-sm">≈ {formatUsd(Math.round(floorValue * holdings.xchUsdRate * 100) / 100)}</div>
          </div>
          {/* Traitfolio value — our trait-aware estimate (the headline number) */}
          <div>
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "#f0c000" }}>Traitfolio value</div>
            <div className="mt-1 text-4xl font-black" style={{ color: "#ffe06a" }}>{formatXch(shownValue)}</div>
            <div className="text-subtle text-sm">≈ {formatUsd(Math.round(shownValue * holdings.xchUsdRate * 100) / 100)}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-title text-2xl font-bold">{filtered.length}</div>
          <div className="text-subtle text-xs uppercase tracking-widest">NFTs</div>
          <div className="text-subtle mt-1 text-xs">
            {holdings.collections.length} collection{holdings.collections.length === 1 ? "" : "s"}{holdings.truncated ? " · capped" : ""}
          </div>
          {enriching && (
            <div className="mt-1 text-[11px] text-violet-300/90">Refining rarity… {Math.round(progress * 100)}%</div>
          )}
        </div>
      </div>

      {/* Enrichment progress bar — fills as per-NFT traits + ranks stream in */}
      {enriching && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(progress * 100)}%`, background: "linear-gradient(90deg, #8b5cf6, #ec4899)" }}
          />
        </div>
      )}

      {/* Full-width tier stats bar */}
      <TierStatsBar collection={SHELL} nfts={scoped} />

      {/* Desktop: filters · binder · collections */}
      <div className="mx-auto hidden items-start justify-center gap-4 md:flex" style={{ maxWidth: 1440 }}>
        <FilterSidebar {...sidebarProps} />
        <div className="min-w-0 flex-1" style={{ maxWidth: 880 }}>
          <BinderView key={binderKey} collection={SHELL} nfts={filtered} hideFullPageLink />
        </div>
        <BinderCollectionPicker
          collections={holdings.collections}
          totalCount={nfts.length}
          selectedId={collectionId}
          onSelect={pickCollection}
        />
      </div>

      {/* Mobile: collection + sort, then binder */}
      <div className="flex flex-col gap-2 md:hidden">
        <div className="flex gap-2">
          <select
            value={collectionId}
            onChange={(e) => pickCollection(e.target.value)}
            className="text-title flex-1 rounded-lg border border-white/15 bg-card-bg px-3 py-2 text-xs font-semibold outline-none"
          >
            <option value="all">All collections ({nfts.length})</option>
            {holdings.collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
            ))}
          </select>
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
        <BinderView key={`m-${binderKey}`} collection={SHELL} nfts={filtered} hideFullPageLink />
      </div>
    </div>
  );
}
