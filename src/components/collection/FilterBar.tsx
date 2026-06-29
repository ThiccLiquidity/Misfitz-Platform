"use client";

import { TIER_ORDER, getTierVisual, type TierId } from "@/lib/rarity/tiers";

export type TierFilter = "all" | TierId;
export type SortKey = "rank-asc" | "rank-desc" | "token-asc" | "token-desc";
// trait_type → selected value ("" = any)
export type TraitFilters = Record<string, string>;

interface FilterBarProps {
  tierFilter: TierFilter;
  onTierFilter: (t: TierFilter) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  search: string;
  onSearch: (s: string) => void;
  traitFilters: TraitFilters;
  onTraitFilter: (traitType: string, value: string) => void;
  traitOptions: Record<string, string[]>; // trait_type → sorted unique values
  resultCount: number;
  totalCount: number;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rank-asc",   label: "Rarest first"     },
  { value: "rank-desc",  label: "Most common first" },
  { value: "token-asc",  label: "Token # ↑"         },
  { value: "token-desc", label: "Token # ↓"         },
];

const selectClass = `
  rounded-lg border border-page-border bg-card-bg px-3 py-1.5
  text-sm text-title cursor-pointer
  focus:outline-none focus:ring-1 focus:ring-card-border
`;

export function FilterBar({
  tierFilter, onTierFilter,
  sort, onSort,
  search, onSearch,
  traitFilters, onTraitFilter,
  traitOptions,
  resultCount, totalCount,
}: FilterBarProps) {
  const hasTraitFilter = Object.values(traitFilters).some((v) => v !== "");
  const isFiltered = tierFilter !== "all" || search.trim() !== "" || hasTraitFilter;

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-2">

      {/* ── Tier chips ── */}
      <div className="flex flex-wrap items-center gap-2">
        <TierChip
          active={tierFilter === "all"}
          onClick={() => onTierFilter("all")}
          label="All"
          accent="rgba(255,255,255,.55)"
        />
        {TIER_ORDER.map((id) => {
          const v = getTierVisual(id);
          return (
            <TierChip
              key={id}
              active={tierFilter === id}
              onClick={() => onTierFilter(tierFilter === id ? "all" : id)}
              label={`${v.symbol} ${v.label}`}
              accent={v.accent}
            />
          );
        })}
      </div>

      {/* ── Trait dropdowns ── */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(traitOptions).map(([traitType, values]) => (
          <div key={traitType} className="flex flex-col gap-0.5">
            <label className="text-[10px] text-subtle uppercase tracking-wider pl-1">
              {traitType}
            </label>
            <select
              value={traitFilters[traitType] ?? ""}
              onChange={(e) => onTraitFilter(traitType, e.target.value)}
              className={selectClass}
              style={
                traitFilters[traitType]
                  ? { borderColor: "rgba(255,255,255,.35)", color: "#fff" }
                  : {}
              }
            >
              <option value="">Any</option>
              {values.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* ── Search + sort + count ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Token search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-subtle select-none">
            #
          </span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Token number…"
            value={search}
            onChange={(e) => onSearch(e.target.value.replace(/\D/g, ""))}
            className="
              w-40 rounded-lg border border-page-border bg-card-bg pl-6 pr-3 py-1.5
              text-sm text-title placeholder:text-subtle
              focus:outline-none focus:ring-1 focus:ring-card-border
            "
          />
        </div>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className={selectClass}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Clear all */}
        {isFiltered && (
          <button
            type="button"
            onClick={() => {
              onTierFilter("all");
              onSearch("");
              Object.keys(traitFilters).forEach((k) => onTraitFilter(k, ""));
            }}
            className="text-xs text-subtle underline hover:text-title transition-colors"
          >
            Clear all
          </button>
        )}

        {/* Result count */}
        <span className="text-xs text-subtle ml-auto">
          {isFiltered
            ? `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} cards`
            : `${totalCount.toLocaleString()} cards`}
        </span>
      </div>
    </div>
  );
}

function TierChip({
  active, onClick, label, accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-bold transition-all"
      style={{
        borderColor: active ? accent : "rgba(255,255,255,.12)",
        color: active ? accent : "rgba(255,255,255,.45)",
        background: active ? `${accent}1a` : "transparent",
        boxShadow: active ? `0 0 10px ${accent}44` : "none",
      }}
    >
      {label}
    </button>
  );
}
