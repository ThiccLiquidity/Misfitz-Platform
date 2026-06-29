"use client";

import React from "react";
import { TIER_ORDER, getTierVisual, type TierId } from "@/lib/rarity/tiers";
import { useThemeMode } from "@/components/theme/ThemeProvider";

export type TierFilter = "all" | TierId;
export type SortKey = "rank-asc" | "rank-desc" | "deal-desc" | "token-asc" | "token-desc";
export type TraitFilters = Record<string, string>;

interface FilterSidebarProps {
  tierFilter: TierFilter;
  onTierFilter: (t: TierFilter) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  traitFilters: TraitFilters;
  onTraitFilter: (traitType: string, value: string) => void;
  traitOptions: Record<string, string[]>;
  resultCount: number;
  totalCount: number;
  /** Sheet mode: no outer container chrome — used when caller wraps in a bottom drawer. */
  sheet?: boolean;
  /** Hide the trait dropdowns (e.g. Your Binder until a single collection is picked). */
  hideTraits?: boolean;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rank-asc",   label: "Rarest first"      },
  { value: "rank-desc",  label: "Most common first"  },
  { value: "deal-desc",  label: "Best deals first"   },
  { value: "token-asc",  label: "Token # ↑"          },
  { value: "token-desc", label: "Token # ↓"          },
];

// Visual config per tier — dark bg for dark mode, frosted tint for light mode
const TIER_CHIP_STYLES: Record<string, {
  bgDark:       string;   // dark mode cell background
  bgLight:      string;   // light mode cell background (frosted tint)
  border:       string;   // gradient border (same both modes)
  glow:         string;   // rgba glow
  textDark:     string;   // gradient text (dark mode — vibrant on dark bg)
  textLight:    string;   // solid color (light mode — reads cleanly on frosted bg)
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

// selectStyle is now applied inline so we can theme with isLight
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
    background: isLight
      ? "rgba(10,30,80,0.07)"
      : "rgba(18,16,28,0.97)",
    border: isLight
      ? "1.5px solid rgba(60,120,220,0.45)"
      : "1.5px solid rgba(255,255,255,0.18)",
    color: isLight ? "#0a1e50" : "rgba(255,255,255,0.88)",
    boxShadow: isLight
      ? "inset 0 1px 3px rgba(0,40,120,0.08)"
      : "inset 0 1px 3px rgba(0,0,0,0.3)",
  };
}

export function FilterSidebar({
  tierFilter, onTierFilter,
  sort, onSort,
  traitFilters, onTraitFilter,
  traitOptions,
  resultCount, totalCount,
  sheet = false,
  hideTraits = false,
}: FilterSidebarProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const hasTraitFilter = Object.values(traitFilters).some((v) => v !== "");
  const isFiltered = tierFilter !== "all" || hasTraitFilter;

  function clearAll() {
    onTierFilter("all");
    Object.keys(traitFilters).forEach((k) => onTraitFilter(k, ""));
  }

  return (
    <div
      className={sheet
        ? "flex flex-col gap-5 p-4 pb-8"
        : "flex flex-col gap-5 flex-shrink-0 rounded-xl p-4 sticky top-4"
      }
      style={sheet ? {} : {
        width: 184,
        background: isLight
          ? "rgba(255,255,255,0.72)"
          : "linear-gradient(175deg, #1e1e22 0%, #121214 100%)",
        border: isLight
          ? "1px solid rgba(100, 180, 255, 0.35)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isLight
          ? "0 4px 24px rgba(0, 80, 160, 0.12), inset 0 1px 0 rgba(255,255,255,0.8)"
          : "0 4px 24px rgba(0,0,0,0.4)",
        backdropFilter: isLight ? "blur(12px)" : undefined,
      }}
    >
      {/* ── Tiers ──────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span
          className="text-[10px] font-black uppercase tracking-widest mb-0.5"
          style={{ color: isLight ? "#1a3a7a" : "rgba(255,255,255,0.7)" }}
        >
          Tier
        </span>

        {/* All */}
        <TierChip
          tierId="all"
          label="All"
          emoji="✦"
          active={tierFilter === "all"}
          onClick={() => onTierFilter("all")}
          isLight={isLight}
        />

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

      {/* ── Traits ─────────────────────────────────────── */}
      {!hideTraits && (
      <div className="flex flex-col gap-3">
        <span
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: isLight ? "#1a3a7a" : "rgba(255,255,255,0.7)" }}
        >
          Traits
        </span>
        {Object.entries(traitOptions).map(([traitType, values]) => (
          <div key={traitType} className="flex flex-col gap-1">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: isLight ? "#2255aa" : "rgba(180,200,255,0.65)" }}
            >
              {traitType}
            </label>
            <select
              value={traitFilters[traitType] ?? ""}
              onChange={(e) => onTraitFilter(traitType, e.target.value)}
              style={selectStyle(isLight)}
            >
              <option value="">Any</option>
              {values.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      )}

      {/* ── Sort ───────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: isLight ? "#1a3a7a" : "rgba(255,255,255,0.7)" }}
        >
          Sort
        </label>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          style={selectStyle(isLight)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <div
        className="mt-auto flex flex-col gap-2 pt-2 border-t"
        style={{ borderColor: isLight ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.05)" }}
      >
        <span className="text-[11px] text-subtle">
          {isFiltered
            ? `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} cards`
            : `${totalCount.toLocaleString()} cards`}
        </span>
        {isFiltered && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-subtle underline underline-offset-2 hover:text-title transition-colors text-left"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

// Mini card chip — gradient border wrapper + tier-appropriate bg + label text
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

  // Shadow: in light mode, reduce the outer glow so it doesn't feel heavy
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
          // Light mode: frosted white overlay so tint reads over the sidebar bg
          backdropFilter: isLight ? "blur(4px)" : undefined,
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
        {isLight ? (
          // Solid color in light mode — reads cleanly on frosted bg
          <span style={{
            color: cfg.textLight,
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}>
            {label}
          </span>
        ) : (
          // Gradient text in dark mode — vibrant on dark bg
          <span style={{
            background: cfg.textDark,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
