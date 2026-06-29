"use client";

import React from "react";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import type { TraitFilters } from "./FilterSidebar";

// Horizontal, wrapping trait-filter bar. Lives ABOVE the binder so trait dropdowns flow
// left-to-right across the full width instead of stacking down a narrow sidebar (which pushed
// the binder out of view on trait-heavy collections). The vertical FilterSidebar keeps Tier +
// Sort; traits live here on desktop. Mobile still surfaces traits inside the filter sheet.
interface TraitFilterBarProps {
  traitOptions: Record<string, string[]>;
  traitFilters: TraitFilters;
  onTraitFilter: (traitType: string, value: string) => void;
}

function fieldStyle(isLight: boolean, active: boolean): React.CSSProperties {
  return {
    width: "100%",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    outline: "none",
    appearance: "auto" as React.CSSProperties["appearance"],
    background: active
      ? isLight ? "rgba(40,100,220,0.12)" : "rgba(120,140,255,0.15)"
      : isLight ? "rgba(10,30,80,0.07)" : "rgba(18,16,28,0.97)",
    border: active
      ? isLight ? "1.5px solid rgba(60,120,220,0.6)" : "1.5px solid rgba(140,160,255,0.5)"
      : isLight ? "1.5px solid rgba(60,120,220,0.45)" : "1.5px solid rgba(255,255,255,0.18)",
    color: isLight ? "#0a1e50" : "rgba(255,255,255,0.88)",
  };
}

export function TraitFilterBar({ traitOptions, traitFilters, onTraitFilter }: TraitFilterBarProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const entries = Object.entries(traitOptions);
  if (entries.length === 0) return null;

  const hasActive = Object.values(traitFilters).some((v) => v !== "");

  return (
    <div
      className="mb-3 rounded-xl p-3"
      style={{
        background: isLight ? "rgba(255,255,255,0.72)" : "linear-gradient(175deg, #1e1e22 0%, #121214 100%)",
        border: isLight ? "1px solid rgba(100, 180, 255, 0.35)" : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isLight ? "0 4px 24px rgba(0, 80, 160, 0.10)" : "0 4px 24px rgba(0,0,0,0.4)",
        backdropFilter: isLight ? "blur(12px)" : undefined,
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: isLight ? "#1a3a7a" : "rgba(255,255,255,0.7)" }}
        >
          Filter by trait
        </span>
        {hasActive && (
          <button
            type="button"
            onClick={() => entries.forEach(([t]) => onTraitFilter(t, ""))}
            className="text-[11px] text-subtle underline underline-offset-2 hover:text-title transition-colors"
          >
            Clear traits
          </button>
        )}
      </div>

      {/* Auto-fitting columns: as many dropdowns per row as fit, then wrap */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
      >
        {entries.map(([traitType, values]) => {
          const active = (traitFilters[traitType] ?? "") !== "";
          return (
            <div key={traitType} className="flex flex-col gap-1 min-w-0">
              <label
                className="text-[10px] font-bold uppercase tracking-wider truncate"
                style={{ color: isLight ? "#2255aa" : "rgba(180,200,255,0.65)" }}
              >
                {traitType}
              </label>
              <select
                value={traitFilters[traitType] ?? ""}
                onChange={(e) => onTraitFilter(traitType, e.target.value)}
                style={fieldStyle(isLight, active)}
              >
                <option value="">Any</option>
                {values.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
