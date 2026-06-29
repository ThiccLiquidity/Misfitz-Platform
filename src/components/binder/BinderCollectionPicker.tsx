"use client";

import { useThemeMode } from "@/components/theme/ThemeProvider";
import type { HeldCollection } from "@/lib/portfolio/myHoldings";

// Right-side collection picker for Your Binder — mirrors the collection page's switcher, but filters
// the binder in place instead of navigating. "All" shows everything; picking one scopes the binder
// (and reveals trait filters).
const ACCENTS = ["#8b5cf6", "#ff6eb4", "#00d4ff", "#5fce7a", "#f59e0b", "#a855f7", "#f87171", "#38bdf8"];

export function BinderCollectionPicker({
  collections,
  totalCount,
  selectedId,
  onSelect,
}: {
  collections: HeldCollection[];
  totalCount: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const row = (id: string, name: string, count: number, accent: string) => {
    const active = selectedId === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onSelect(id)}
        className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-all"
        style={{
          background: active
            ? `linear-gradient(135deg, ${accent}20, ${accent}10)`
            : isLight ? `linear-gradient(135deg, ${accent}0a, transparent)` : "transparent",
          border: `1px solid ${active ? `${accent}55` : isLight ? `${accent}33` : "transparent"}`,
          boxShadow: active ? `0 0 12px ${accent}33` : "none",
        }}
      >
        <div
          className="flex-shrink-0 rounded-sm"
          style={{ width: 6, height: 38, flexShrink: 0, background: `linear-gradient(180deg, ${accent}ee 0%, ${accent}99 100%)` }}
        />
        <div className="min-w-0">
          <div
            className="truncate text-[11px] font-bold leading-tight"
            style={{ color: active ? accent : isLight ? "#2a3a55" : "rgba(255,255,255,0.65)" }}
          >
            {name}
          </div>
          <div className="mt-0.5 truncate text-[9px] font-semibold" style={{ color: isLight ? "#6b8db0" : "rgba(255,255,255,0.4)" }}>
            {count.toLocaleString()} NFTs
          </div>
        </div>
      </button>
    );
  };

  return (
    <div
      className="sticky top-4 flex flex-shrink-0 flex-col gap-1 rounded-xl p-3"
      style={{
        width: 248,
        background: isLight ? "rgba(255,255,255,0.72)" : "linear-gradient(175deg, #1e1e22 0%, #121214 100%)",
        border: isLight ? "1px solid rgba(100, 180, 255, 0.35)" : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isLight ? "0 4px 24px rgba(0, 80, 160, 0.12), inset 0 1px 0 rgba(255,255,255,0.8)" : "0 4px 24px rgba(0,0,0,0.4)",
        backdropFilter: isLight ? "blur(12px)" : undefined,
      }}
    >
      <div
        className="mb-2 border-b pb-2 text-[10px] font-semibold uppercase tracking-widest text-subtle"
        style={{ borderColor: isLight ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.05)" }}
      >
        Collections
      </div>
      <div className="grid grid-cols-2 gap-1.5 overflow-y-auto" style={{ maxHeight: 470 }}>
        {row("all", "All collections", totalCount, "#8b5cf6")}
        {collections.map((c, i) => row(c.id, c.name, c.count, ACCENTS[(i + 1) % ACCENTS.length]))}
      </div>
    </div>
  );
}
