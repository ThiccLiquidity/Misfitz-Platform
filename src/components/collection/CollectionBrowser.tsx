"use client";

import React, { useState, useMemo, useCallback } from "react";
import type { CollectionData, NftData } from "@/types";
import { tierIdForPercentile, resolveTierThresholds } from "@/lib/rarity/tiers";
import { BinderView } from "@/components/binder/BinderView";
import { FilterSidebar, type TierFilter, type SortKey, type TraitFilters } from "./FilterSidebar";
import { CollectionSwitcher } from "./CollectionSwitcher";
import { useThemeMode } from "@/components/theme/ThemeProvider";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rank-asc",   label: "Rarest first"     },
  { value: "rank-desc",  label: "Most common first" },
  { value: "token-asc",  label: "Token # ↑"         },
  { value: "token-desc", label: "Token # ↓"         },
];

interface CollectionBrowserProps {
  collection: CollectionData;
  allCollections?: CollectionData[];
  nfts: NftData[];
}

export function CollectionBrowser({ collection, nfts, allCollections }: CollectionBrowserProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const [tierFilter,       setTierFilter]       = useState<TierFilter>("all");
  const [sort,             setSort]             = useState<SortKey>("rank-asc");
  const [traitFilters,     setTraitFilters]     = useState<TraitFilters>({});
  const [filterSheetOpen,  setFilterSheetOpen]  = useState(false);

  const thresholds = useMemo(
    () => resolveTierThresholds(collection.rarityTiers),
    [collection.rarityTiers],
  );

  const traitOptions = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const nft of nfts) {
      for (const t of nft.traits) {
        if (!map[t.trait_type]) map[t.trait_type] = new Set();
        map[t.trait_type].add(t.value as string);
      }
    }
    const result: Record<string, string[]> = {};
    for (const [type, vals] of Object.entries(map)) {
      result[type] = [...vals].sort();
    }
    return result;
  }, [nfts]);

  const handleTraitFilter = useCallback((traitType: string, value: string) => {
    setTraitFilters((prev) => ({ ...prev, [traitType]: value }));
  }, []);

  const activeFilterCount = useMemo(
    () =>
      (tierFilter !== "all" ? 1 : 0) +
      Object.values(traitFilters).filter((v) => v !== "").length,
    [tierFilter, traitFilters],
  );

  const filtered = useMemo(() => {
    let result = nfts;

    if (tierFilter !== "all") {
      result = result.filter((nft) => {
        if (!nft.rarityRank) return false;
        const pct = (nft.rarityRank / collection.totalSupply) * 100;
        return tierIdForPercentile(pct, thresholds) === tierFilter;
      });
    }

    const activeTraits = Object.entries(traitFilters).filter(([, v]) => v !== "");
    if (activeTraits.length > 0) {
      result = result.filter((nft) =>
        activeTraits.every(([type, val]) =>
          nft.traits.some((t) => t.trait_type === type && t.value === val),
        ),
      );
    }

    const sorted = [...result];
    switch (sort) {
      case "rank-asc":   sorted.sort((a, b) => (a.rarityRank ?? 99999) - (b.rarityRank ?? 99999)); break;
      case "rank-desc":  sorted.sort((a, b) => (b.rarityRank ?? 0)     - (a.rarityRank ?? 0));     break;
      case "token-asc":  sorted.sort((a, b) => tokenNum(a) - tokenNum(b));                          break;
      case "token-desc": sorted.sort((a, b) => tokenNum(b) - tokenNum(a));                          break;
    }
    return sorted;
  }, [nfts, tierFilter, traitFilters, sort, thresholds, collection.totalSupply]);

  const binderKey = `${tierFilter}|${sort}|${JSON.stringify(traitFilters)}`;

  // Shared sidebar props
  const sidebarProps = {
    tierFilter,   onTierFilter: setTierFilter,
    sort,         onSort:       setSort,
    traitFilters, onTraitFilter: handleTraitFilter,
    traitOptions,
    resultCount:  filtered.length,
    totalCount:   nfts.length,
  };

  return (
    <>
      {/* ── Desktop layout ─────────────────────────────────────────────── */}
      <div className="hidden md:flex gap-4 items-start mx-auto justify-center" style={{ maxWidth: 1440 }}>
        <FilterSidebar {...sidebarProps} />
        <div className="flex-1 min-w-0" style={{ maxWidth: 930 }}>
          <BinderView key={binderKey} collection={collection} nfts={filtered} />
        </div>
        {allCollections && (
          <CollectionSwitcher collections={allCollections} currentSlug={collection.slug} />
        )}
      </div>

      {/* ── Mobile layout ──────────────────────────────────────────────── */}
      <div className="flex flex-col md:hidden">
        {/* Mobile top bar: sort + filter button */}
        <div
          className="flex items-center gap-2 px-1 pb-3"
        >
          {/* Sort compact select */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{
              flex: 1,
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              outline: "none",
              appearance: "auto" as React.CSSProperties["appearance"],
              background: isLight ? "rgba(10,30,80,0.07)" : "rgba(18,16,28,0.97)",
              border: isLight ? "1.5px solid rgba(60,120,220,0.35)" : "1.5px solid rgba(255,255,255,0.14)",
              color: isLight ? "#0a1e50" : "rgba(255,255,255,0.85)",
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Filters button */}
          <button
            type="button"
            onClick={() => setFilterSheetOpen(true)}
            style={{
              flexShrink: 0,
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              border: activeFilterCount > 0
                ? isLight ? "1.5px solid rgba(60,120,220,0.6)" : "1.5px solid rgba(140,160,255,0.5)"
                : isLight ? "1.5px solid rgba(60,120,220,0.25)" : "1.5px solid rgba(255,255,255,0.14)",
              background: activeFilterCount > 0
                ? isLight ? "rgba(40,100,220,0.12)" : "rgba(120,140,255,0.15)"
                : isLight ? "rgba(10,30,80,0.06)" : "rgba(18,16,28,0.97)",
              color: activeFilterCount > 0
                ? isLight ? "#1144cc" : "#a0b4ff"
                : isLight ? "#0a1e50" : "rgba(255,255,255,0.70)",
            }}
          >
            {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
          </button>
        </div>

        {/* Mobile binder */}
        <BinderView key={`mobile-${binderKey}`} collection={collection} nfts={filtered} />
      </div>

      {/* ── Mobile filter bottom sheet ─────────────────────────────────── */}
      {filterSheetOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={() => setFilterSheetOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" style={{ backdropFilter: "blur(4px)" }} />

          {/* Sheet panel */}
          <div
            className="relative rounded-t-2xl overflow-y-auto"
            style={{
              maxHeight: "85vh",
              background: isLight
                ? "rgba(255,255,255,0.97)"
                : "rgba(22,20,30,0.98)",
              border: isLight
                ? "1px solid rgba(100,180,255,0.30)"
                : "1px solid rgba(255,255,255,0.08)",
              borderBottom: "none",
              boxShadow: isLight
                ? "0 -8px 40px rgba(0,80,160,0.14)"
                : "0 -8px 40px rgba(0,0,0,0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.22)" }}
              />
            </div>

            {/* Sheet header */}
            <div
              className="flex items-center justify-between px-4 py-2"
              style={{ borderBottom: isLight ? "1px solid rgba(100,180,255,0.18)" : "1px solid rgba(255,255,255,0.07)" }}
            >
              <span
                className="text-sm font-black uppercase tracking-widest"
                style={{ color: isLight ? "#1a3a7a" : "rgba(255,255,255,0.80)" }}
              >
                Filters
              </span>
              <button
                type="button"
                onClick={() => setFilterSheetOpen(false)}
                className="text-base font-bold hover:opacity-60 transition-opacity"
                style={{ color: isLight ? "#666" : "rgba(255,255,255,0.45)" }}
              >
                ✕
              </button>
            </div>

            {/* Sidebar content inside sheet */}
            <FilterSidebar {...sidebarProps} sheet={true} />
          </div>
        </div>
      )}
    </>
  );
}

function tokenNum(nft: NftData): number {
  const m = nft.name.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
