"use client";

import { useState, useMemo, useCallback } from "react";
import type { CollectionData, NftData } from "@/types";
import { tierIdForPercentile, resolveTierThresholds } from "@/lib/rarity/tiers";
import { BinderView } from "@/components/binder/BinderView";
import { FilterSidebar, type TierFilter, type SortKey, type TraitFilters } from "./FilterSidebar";
import { CollectionSwitcher } from "./CollectionSwitcher";

interface CollectionBrowserProps {
  collection: CollectionData;
  allCollections?: CollectionData[];
  nfts: NftData[];
}

export function CollectionBrowser({ collection, nfts, allCollections }: CollectionBrowserProps) {
  const [tierFilter,   setTierFilter]   = useState<TierFilter>("all");
  const [sort,         setSort]         = useState<SortKey>("rank-asc");
  const [traitFilters, setTraitFilters] = useState<TraitFilters>({});

  const thresholds = useMemo(
    () => resolveTierThresholds(collection.rarityTiers),
    [collection.rarityTiers],
  );

  // Build sorted unique values per trait type — computed once from the full set
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

  const filtered = useMemo(() => {
    let result = nfts;

    // Tier
    if (tierFilter !== "all") {
      result = result.filter((nft) => {
        if (!nft.rarityRank) return false;
        const pct = (nft.rarityRank / collection.totalSupply) * 100;
        return tierIdForPercentile(pct, thresholds) === tierFilter;
      });
    }

    // Traits (AND — must match every active selection)
    const activeTraits = Object.entries(traitFilters).filter(([, v]) => v !== "");
    if (activeTraits.length > 0) {
      result = result.filter((nft) =>
        activeTraits.every(([type, val]) =>
          nft.traits.some((t) => t.trait_type === type && t.value === val),
        ),
      );
    }

    // Sort
    const sorted = [...result];
    switch (sort) {
      case "rank-asc":   sorted.sort((a, b) => (a.rarityRank ?? 99999) - (b.rarityRank ?? 99999)); break;
      case "rank-desc":  sorted.sort((a, b) => (b.rarityRank ?? 0)     - (a.rarityRank ?? 0));     break;
      case "token-asc":  sorted.sort((a, b) => tokenNum(a) - tokenNum(b));                          break;
      case "token-desc": sorted.sort((a, b) => tokenNum(b) - tokenNum(a));                          break;
    }
    return sorted;
  }, [nfts, tierFilter, traitFilters, sort, thresholds, collection.totalSupply]);

  // Any filter change resets the binder to spread 1
  const binderKey = `${tierFilter}|${sort}|${JSON.stringify(traitFilters)}`;

  return (
    <div className="flex gap-4 items-start mx-auto justify-center" style={{ maxWidth: 1440 }}>
      <FilterSidebar
        tierFilter={tierFilter}     onTierFilter={setTierFilter}
        sort={sort}                 onSort={setSort}
        traitFilters={traitFilters} onTraitFilter={handleTraitFilter}
        traitOptions={traitOptions}
        resultCount={filtered.length}
        totalCount={nfts.length}
      />
      {/* Binder — capped so 3×3 cards stay at ~0.71:1 portrait ratio with both sidebars present */}
      <div className="flex-1 min-w-0" style={{ maxWidth: 930 }}>
        <BinderView key={binderKey} collection={collection} nfts={filtered} />
      </div>

      {/* Right panel — collection switcher fills what was dead space */}
      {allCollections && (
        <CollectionSwitcher collections={allCollections} currentSlug={collection.slug} />
      )}
    </div>
  );
}

function tokenNum(nft: NftData): number {
  const m = nft.name.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
