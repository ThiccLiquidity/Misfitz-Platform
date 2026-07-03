"use client";

import React from "react";
import { TIER_ORDER, getTierVisual, type TierId } from "@/lib/rarity/tiers";
import { useThemeMode } from "@/components/theme/ThemeProvider";

export type TierFilter = "all" | TierId;
export type SortKey = "rank-asc" | "rank-desc" | "deal-desc" | "price-asc" | "price-desc" | "token-asc" | "token-desc";
export type TraitFilters = Record<string, string>;
/** Marketplace CAT-offer visibility: show everything, hide CAT-inclusive offers, or show only those. */
export type CatFilter = "all" | "hide" | "only";

interface FilterSidebarProps {
  tierFilter: TierFilter;
  onTierFilter: (t: TierFilter) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  traitFilters: TraitFilters;
  onTraitFilter: (traitType: string, value: string) => void;
  traitOptions: Record<string, string[]>;
  hotTraitKeys?: Set<string>; // "type|value" (lowercase) entries currently in demand -> show fire
  trendingTraits?: { traitType: string; value: string; ratio: number }[]; // clickable hot-trait chips
  resultCount: number;
  totalCount: number;
  /** Sheet mode: no outer container chrome — used when caller wraps in a bottom drawer. */
  sheet?: boolean;
  /** Hide the trait dropdowns (e.g. Your Binder until a single collection is picked). */
  hideTraits?: boolean;
  /** Search by token #number or launcher id — only rendered when onSearch is provided. */
  searchQuery?: string;
  onSearch?: (q: string) => void;
  /** Marketplace/shop controls — only rendered when onForSaleOnly is provided (collection shop). */
  forSaleOnly?: boolean;
  onForSaleOnly?: (v: boolean) => void;
  priceMin?: string;
  priceMax?: string;
  onPriceRange?: (min: string, max: string) => void;
  listedCount?: number;
  /** CAT-offer visibility — only rendered when onCatFilter is provided (collection shop). */
  catFilter?: CatFilter;
  onCatFilter?: (v: CatFilter) => void;
  catCount?: number;
  /** Collector-number (numerology) filter — only rendered when onCollectorOnly is provided. */
  collectorOnly?: boolean;
  onCollectorOnly?: (v: boolean) => void;
  collectorTier?: number; // keep collectible badges with tier <= this (1=grail ... 4=fun)
  onCollectorTier?: (t: number) => void;
  collectorCount?: number;
}

// Ordered by what collectors reach for most: rarity, then deals/price, then the long tail.
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rank-asc",   label: "Rarest first"       },
  { value: "deal-desc",  label: "Best deals first"   },
  { value: "price-asc",  label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "rank-desc",  label: "Most common first"  },
  { value: "token-asc",  label: "Token # up"         },
  { value: "token-desc", label: "Token # down"       },
];

// The deal-tag legend — mirrors the for-sale card tags exactly (mark + colour + meaning).
const DEAL_LEGEND: { mark: string; color: string; label: string }[] = [
  { mark: "↓", color: "#22c55e",              label: "Deal — under our estimate" },
  { mark: "≈", color: "#3b82f6",              label: "Fair — around our estimate" },
  { mark: "↑", color: "#e8a13a",              label: "Above our estimate" },
  { mark: "•", color: "rgba(71,85,105,0.95)", label: "CAT / not scored" },
];

// Visual config per tier — dark bg for dark mode, frosted tint for light mode
const TIER_CHIP_STYLES: Record<string, {
  bgDark:       string;
  bgLight:      string;
  border:       string;
  glow:         string;
  textDark:     string;
  textLight:    string;
}> = {
  all: {
    bgDark:    "linear-gradient(135deg, #0a1428 0%, #060e1e 100%)",
    bgLight:   "linear-gradient(135deg, rgba(100,150,240,0.09) 0%, rgba(60,100,200,0.04) 100%)",
    border:    "linear-gradient(135deg, #aaccff 0%, #ffffff 50%, #aaccff 100%)",
    glow:      "rgba(160,200,255,0.4)",
    textDark:  "linear-gradient(90deg, #c0d8ff, #ffffff, #c0d8ff)",
    textLight: "#1144aa",
  },
  mythic: {
    bgDark:    "linear-gradient(135deg, #1a0035 0%, #0e001e 100%)",
    bgLight:   "linear-gradient(135deg, rgba(180,60,255,0.09) 0%, rgba(140,40,220,0.04) 100%)",
    border:    "linear-gradient(90deg, #ff60cc 0%, #cc88ff 22%, #60ccff 44%, #88ff88 66%, #ffee44 88%, #ff9944 100%)",
    glow:      "rgba(200,80,255,0.55)",
    textDark:  "linear-gradient(90deg, #ff80dd, #dd99ff, #80ddff, #aaff99, #ffee66, #ffaa55)",
    textLight: "#7700bb",
  },
  legendary: {
    bgDark:    "linear-gradient(135deg, #1a1100 0%, #100900 100%)",
    bgLight:   "linear-gradient(135deg, rgba(220,160,0,0.11) 0%, rgba(180,120,0,0.04) 100%)",
    border:    "linear-gradient(90deg, #c89000 0%, #f0c000 35%, #ffe577 55%, #f0c000 75%, #c89000 100%)",
    glow:      "rgba(240,180,0,0.5)",
    textDark:  "linear-gradient(90deg, #c89000, #f0c000, #ffe577, #f0c000, #c89000)",
    textLight: "#8a6000",
  },
  epic: {
    bgDark:    "linear-gradient(135deg, #000e36 0%, #000820 100%)",
    bgLight:   "linear-gradient(135deg, rgba(60,120,240,0.09) 0%, rgba(40,90,200,0.04) 100%)",
    border:    "linear-gradient(90deg, #3377cc 0%, #88bbff 45%, #c0ddff 60%, #88bbff 75%, #3377cc 100%)",
    glow:      "rgba(100,170,255,0.5)",
    textDark:  "linear-gradient(90deg, #5599ee, #99ccff, #c0e0ff, #99ccff, #5599ee)",
    textLight: "#1144cc",
  },
  rare: {
    bgDark:    "linear-gradient(135deg, #1a0000 0%, #0e0000 100%)",
    bgLight:   "linear-gradient(135deg, rgba(220,40,40,0.09) 0%, rgba(180,20,20,0.04) 100%)",
    border:    "linear-gradient(90deg, #cc1111 0%, #ff6060 38%, #ff9944 58%, #ff6060 78%, #cc1111 100%)",
    glow:      "rgba(255,80,80,0.5)",
    textDark:  "linear-gradient(90deg, #cc2222, #ff6666, #ff9955, #ff6666, #cc2222)",
    textLight: "#bb1111",
  },
  uncommon: {
    bgDark:    "linear-gradient(135deg, #001a06 0%, #001004 100%)",
    bgLight:   "linear-gradient(135deg, rgba(40,180,80,0.09) 0%, rgba(20,140,50,0.04) 100%)",
    border:    "linear-gradient(90deg, #1a8035 0%, #5fce7a 40%, #aaee99 60%, #5fce7a 78%, #1a8035 100%)",
    glow:      "rgba(80,200,110,0.5)",
    textDark:  "linear-gradient(90deg, #1a8035, #5fce7a, #aaee99, #5fce7a, #1a8035)",
    textLight: "#116622",
  },
  common: {
    bgDark:    "linear-gradient(135deg, #00071a 0%, #000412 100%)",
    bgLight:   "linear-gradient(135deg, rgba(50,110,210,0.09) 0%, rgba(30,80,170,0.04) 100%)",
    border:    "linear-gradient(90deg, #2244aa 0%, #6090e0 40%, #99bbff 60%, #6090e0 78%, #2244aa 100%)",
    glow:      "rgba(100,150,240,0.45)",
    textDark:  "linear-gradient(90deg, #2244aa, #6090e0, #99bbff, #6090e0, #2244aa)",
    textLight: "#1133bb",
  },
};

const TIER_SOLID_DARK: Record<string, string> = {
  all:       "#d6e4ff",
  mythic:    "#e6a8ff",
  legendary: "#ffd86b",
  epic:      "#a8cdff",
  rare:      "#ff9a9a",
  uncommon:  "#86e6a0",
  common:    "#9bb8ff",
};

function selectStyle(isLight: boolean): React.CSSProperties {
  return {
    width: "100%",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    outline: "none",
    appearance: "auto" as React.CSSProperties["appearance"],
    background: isLight ? "rgba(10,30,80,0.07)" : "rgba(18,16,28,0.97)",
    border: isLight ? "1.5px solid rgba(60,120,220,0.45)" : "1.5px solid rgba(255,255,255,0.18)",
    color: isLight ? "#0a1e50" : "rgba(255,255,255,0.88)",
    boxShadow: isLight ? "inset 0 1px 3px rgba(0,40,120,0.08)" : "inset 0 1px 3px rgba(0,0,0,0.3)",
  };
}

function labelColor(isLight: boolean): string {
  return isLight ? "#1a3a7a" : "rgba(255,255,255,0.72)";
}

function SectionLabel({ children, isLight, color }: { children: React.ReactNode; isLight: boolean; color?: string }) {
  return (
    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: color ?? labelColor(isLight) }}>
      {children}
    </span>
  );
}

// Collapsible section via native <details> — no extra state, keyboard-accessible, and lets a long
// section (Traits, Collector) fold away so the rail never runs off-screen.
function Collapsible({
  title, isLight, defaultOpen = true, color, children,
}: {
  title: string; isLight: boolean; defaultOpen?: boolean; color?: string; children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group flex flex-col">
      <summary className="flex cursor-pointer select-none list-none items-center justify-between marker:hidden [&::-webkit-details-marker]:hidden">
        <SectionLabel isLight={isLight} color={color}>{title}</SectionLabel>
        <span className="text-[10px] transition-transform group-open:rotate-90" style={{ color: color ?? labelColor(isLight), opacity: 0.65 }}>&#9656;</span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

export function FilterSidebar({
  tierFilter, onTierFilter,
  sort, onSort,
  traitFilters, onTraitFilter,
  traitOptions,
  hotTraitKeys,
  trendingTraits,
  resultCount, totalCount,
  sheet = false,
  hideTraits = false,
  searchQuery, onSearch,
  forSaleOnly, onForSaleOnly, priceMin, priceMax, onPriceRange, listedCount,
  catFilter = "all", onCatFilter, catCount,
  collectorOnly, onCollectorOnly, collectorTier = 4, onCollectorTier, collectorCount,
}: FilterSidebarProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const hasTraitFilter = Object.values(traitFilters).some((v) => v !== "");
  const isFiltered = tierFilter !== "all" || hasTraitFilter || (searchQuery ?? "") !== "" || catFilter !== "all";

  function clearAll() {
    onTierFilter("all");
    Object.keys(traitFilters).forEach((k) => onTraitFilter(k, ""));
    onSearch?.("");
    onCatFilter?.("all");
  }

  const tierLabel = tierFilter === "all" ? null : getTierVisual(tierFilter).label;

  return (
    <div
      className={sheet
        ? "flex flex-col gap-5 p-4 pb-8"
        : "flex flex-col gap-5 flex-shrink-0 rounded-xl p-4 sticky top-4"
      }
      style={sheet ? {} : {
        width: 260,
        maxHeight: "calc(100vh - 2rem)",
        overflowY: "auto",
        background: isLight ? "rgba(255,255,255,0.72)" : "linear-gradient(175deg, #1e1e22 0%, #121214 100%)",
        border: isLight ? "1px solid rgba(100, 180, 255, 0.35)" : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isLight
          ? "0 4px 24px rgba(0, 80, 160, 0.12), inset 0 1px 0 rgba(255,255,255,0.8)"
          : "0 4px 24px rgba(0,0,0,0.4)",
        backdropFilter: isLight ? "blur(12px)" : undefined,
      }}
    >
      {/* Search */}
      {onSearch && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel isLight={isLight}>Find an NFT</SectionLabel>
          <div className="relative">
            <input
              value={searchQuery ?? ""}
              onChange={(e) => onSearch(e.target.value)}
              inputMode="search"
              placeholder="#number or nft1... id"
              style={{ ...selectStyle(isLight), paddingRight: 28, cursor: "text" }}
            />
            {(searchQuery ?? "") !== "" && (
              <button
                type="button"
                onClick={() => onSearch("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-xs opacity-60 hover:opacity-100"
                style={{ color: isLight ? "#0a1e50" : "rgba(255,255,255,0.8)" }}
              >
                &#10005;
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sort */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-black uppercase tracking-widest" style={{ color: isLight ? "#1a3a7a" : "rgba(255,255,255,0.82)" }}>
          Sort by
        </label>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          style={{
            ...selectStyle(isLight),
            padding: "9px 10px",
            fontSize: 13,
            fontWeight: 700,
            border: isLight ? "1.5px solid rgba(60,120,220,0.65)" : "1.5px solid rgba(140,160,255,0.5)",
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Tiers */}
      <div className="flex flex-col gap-2">
        <SectionLabel isLight={isLight}>Tier</SectionLabel>
        <TierChip tierId="all" label="All" emoji="✦" active={tierFilter === "all"} onClick={() => onTierFilter("all")} isLight={isLight} />
        {TIER_ORDER.map((id) => {
          const v = getTierVisual(id);
          return (
            <TierChip
              key={id}
              tierId={id}
              label={v.label}
              emoji={v.emoji}
              active={tierFilter === id}
              onClick={() => onTierFilter(tierFilter === id ? "all" : id)}
              isLight={isLight}
            />
          );
        })}
      </div>

      {/* Marketplace */}
      {onForSaleOnly && (
        <Collapsible title="Marketplace" isLight={isLight} defaultOpen>
          <button type="button" onClick={() => onForSaleOnly(!forSaleOnly)}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-bold transition"
            style={{
              border: forSaleOnly ? "1.5px solid rgba(80,200,120,0.65)" : isLight ? "1.5px solid rgba(60,120,220,0.3)" : "1.5px solid rgba(255,255,255,0.14)",
              background: forSaleOnly ? "rgba(40,180,90,0.14)" : "transparent",
              color: forSaleOnly ? "#5fce7a" : isLight ? "#0a1e50" : "rgba(255,255,255,0.72)",
            }}>
            <span>&#128722; For sale only</span>
            <span>{forSaleOnly ? `ON · ${(listedCount ?? 0).toLocaleString()}` : "OFF"}</span>
          </button>

          <div className="flex items-center gap-2">
            <input inputMode="decimal" placeholder="Min" value={priceMin ?? ""}
              onChange={(e) => onPriceRange?.(e.target.value, priceMax ?? "")} style={{ ...selectStyle(isLight), cursor: "text" }} />
            <span className="text-subtle text-xs">&ndash;</span>
            <input inputMode="decimal" placeholder="Max" value={priceMax ?? ""}
              onChange={(e) => onPriceRange?.(priceMin ?? "", e.target.value)} style={{ ...selectStyle(isLight), cursor: "text" }} />
          </div>
          <span className="text-subtle text-[10px]">Price range (XCH)</span>

          {onCatFilter && (
            <div className="mt-1 flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: isLight ? "#2255aa" : "rgba(180,200,255,0.65)" }}>
                CAT-token offers{typeof catCount === "number" ? ` · ${catCount.toLocaleString()}` : ""}
              </span>
              <div className="grid grid-cols-3 gap-1">
                {([
                  { key: "all",  label: "Show" },
                  { key: "hide", label: "Hide" },
                  { key: "only", label: "Only" },
                ] as const).map((seg) => {
                  const active = catFilter === seg.key;
                  return (
                    <button key={seg.key} type="button" onClick={() => onCatFilter(seg.key)}
                      className="rounded-md px-2 py-1.5 text-[11px] font-bold transition"
                      style={{
                        border: active ? "1.5px solid rgba(140,160,255,0.6)" : isLight ? "1px solid rgba(60,120,220,0.28)" : "1px solid rgba(255,255,255,0.12)",
                        background: active ? (isLight ? "rgba(40,100,220,0.12)" : "rgba(120,140,255,0.16)") : "transparent",
                        color: active ? (isLight ? "#1144cc" : "#a0b4ff") : (isLight ? "#0a1e50" : "rgba(255,255,255,0.62)"),
                      }}>
                      {seg.label}
                    </button>
                  );
                })}
              </div>
              <span className="text-subtle text-[10px]">Their XCH price is a floor (tag shows &ldquo;+&rdquo;).</span>
            </div>
          )}

          <div className="mt-2 flex flex-col gap-1.5 rounded-lg px-2.5 py-2"
            style={{ border: isLight ? "1px solid rgba(60,120,220,0.2)" : "1px solid rgba(255,255,255,0.08)", background: isLight ? "rgba(10,30,80,0.03)" : "rgba(255,255,255,0.02)" }}>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: isLight ? "#2255aa" : "rgba(180,200,255,0.65)" }}>
              What the tags mean
            </span>
            {DEAL_LEGEND.map((d) => (
              <div key={d.label} className="flex items-center gap-2">
                <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
                  style={{ background: d.color, minWidth: 30, padding: "1px 6px", border: "1px solid rgba(255,255,255,0.35)" }}>
                  {d.mark}
                </span>
                <span className="text-[11px]" style={{ color: isLight ? "#334a72" : "rgba(255,255,255,0.72)" }}>{d.label}</span>
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {/* Trending traits */}
      {!hideTraits && trendingTraits && trendingTraits.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel isLight={isLight} color={isLight ? "#b45309" : "#f4a940"}>&#128293; Trending traits</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {trendingTraits.map((t) => {
              const active = (traitFilters[t.traitType] ?? "") === t.value;
              return (
                <button
                  key={`${t.traitType}|${t.value}`}
                  type="button"
                  onClick={() => onTraitFilter(t.traitType, active ? "" : t.value)}
                  title={`${t.traitType}: ${t.value} — selling about ${t.ratio.toFixed(1)}x as often as its share of the collection`}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-90"
                  style={{
                    background: active ? (isLight ? "rgba(180,83,9,0.16)" : "rgba(244,169,64,0.20)") : (isLight ? "rgba(180,83,9,0.07)" : "rgba(255,255,255,0.05)"),
                    border: `1px solid ${active ? (isLight ? "#b45309" : "#f4a940") : (isLight ? "rgba(180,83,9,0.30)" : "rgba(255,255,255,0.12)")}`,
                    color: isLight ? "#7a3d00" : "#ffddab",
                  }}
                >
                  &#128293; {t.value}
                  <span style={{ opacity: 0.55 }}> · {t.traitType}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Collector numbers */}
      {onCollectorOnly && (
        <Collapsible title="Collector numbers" isLight={isLight} defaultOpen={false} color={isLight ? "#7a5500" : "rgba(255,255,255,0.7)"}>
          <button type="button" onClick={() => onCollectorOnly(!collectorOnly)}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-bold transition"
            style={{
              border: collectorOnly ? "1.5px solid rgba(240,192,0,0.65)" : isLight ? "1.5px solid rgba(60,120,220,0.3)" : "1.5px solid rgba(255,255,255,0.14)",
              background: collectorOnly ? "rgba(240,192,0,0.14)" : "transparent",
              color: collectorOnly ? "#f0c000" : isLight ? "#0a1e50" : "rgba(255,255,255,0.72)",
            }}>
            <span>&#9733; Collector #s only</span>
            <span>{collectorOnly ? `ON · ${(collectorCount ?? 0).toLocaleString()}` : "OFF"}</span>
          </button>
          {collectorOnly && (
            <select value={collectorTier} onChange={(e) => onCollectorTier?.(Number(e.target.value))} style={selectStyle(isLight)}>
              <option value={4}>All special numbers</option>
              <option value={3}>Notable &amp; better</option>
              <option value={2}>Strong &amp; grails</option>
              <option value={1}>Grails only &#9733;</option>
            </select>
          )}
          <span className="text-subtle text-[10px]">e.g. 69, 420, 777, 1, palindromes, runs</span>
        </Collapsible>
      )}

      {/* Traits */}
      {!hideTraits && Object.keys(traitOptions).length > 0 && (
        <Collapsible title="Traits" isLight={isLight} defaultOpen={!sheet}>
          <div className="grid grid-cols-2 gap-x-2 gap-y-2 overflow-y-auto pr-1" style={sheet ? {} : { maxHeight: 280 }}>
            {Object.entries(traitOptions).map(([traitType, values]) => {
              const active = (traitFilters[traitType] ?? "") !== "";
              return (
                <div key={traitType} className="flex min-w-0 flex-col gap-1">
                  <label className="truncate text-[10px] font-bold uppercase tracking-wider" style={{ color: isLight ? "#2255aa" : "rgba(180,200,255,0.65)" }}>
                    {traitType}
                  </label>
                  <select
                    value={traitFilters[traitType] ?? ""}
                    onChange={(e) => onTraitFilter(traitType, e.target.value)}
                    style={{ ...selectStyle(isLight), ...(active ? { borderColor: isLight ? "rgba(60,120,220,0.7)" : "rgba(140,160,255,0.6)" } : {}) }}
                  >
                    <option value="">Any</option>
                    {values.map((v) => (
                      <option key={v} value={v}>
                        {v}{hotTraitKeys?.has(`${traitType.toLowerCase()}|${String(v).toLowerCase()}`) ? " 🔥" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </Collapsible>
      )}

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-2 pt-2 border-t" style={{ borderColor: isLight ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.05)" }}>
        <span className="text-[11px] text-subtle">
          {forSaleOnly && sort === "deal-desc" && tierLabel
            ? `Best ${tierLabel} deals · ${resultCount.toLocaleString()} of ${totalCount.toLocaleString()}`
            : isFiltered
              ? `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} cards`
              : `${totalCount.toLocaleString()} cards`}
        </span>
        {isFiltered && (
          <button type="button" onClick={clearAll}
            className="text-[11px] text-subtle underline underline-offset-2 hover:text-title transition-colors text-left">
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function TierChip({
  tierId, label, emoji, active, onClick, isLight,
}: {
  tierId: string;
  label: string;
  emoji: string;
  active: boolean;
  onClick: () => void;
  isLight: boolean;
}) {
  const cfg = TIER_CHIP_STYLES[tierId] ?? TIER_CHIP_STYLES.all;
  const borderThickness = active ? 2.5 : 1.5;
  const bg = isLight ? cfg.bgLight : cfg.bgDark;

  const shadow = active
    ? isLight
      ? `0 0 12px ${cfg.glow}88, 0 2px 6px rgba(0,0,0,0.12)`
      : `0 0 18px ${cfg.glow}, 0 2px 8px rgba(0,0,0,0.5)`
    : isLight
      ? `0 0 4px ${cfg.glow}44, 0 1px 3px rgba(0,0,0,0.07)`
      : `0 0 6px ${cfg.glow}44, 0 1px 4px rgba(0,0,0,0.3)`;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      style={{
        background: cfg.border,
        padding: borderThickness,
        borderRadius: 10,
        cursor: "pointer",
        boxShadow: shadow,
        transition: "box-shadow 0.15s ease",
        opacity: active ? 1 : isLight ? 0.78 : 0.72,
      }}
    >
      <div
        style={{
          background: bg,
          borderRadius: 8,
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 7,
          backdropFilter: isLight ? "blur(4px)" : undefined,
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
        <span style={{
          color: isLight ? cfg.textLight : (TIER_SOLID_DARK[tierId] ?? "#e6ecff"),
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          lineHeight: 1,
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}
