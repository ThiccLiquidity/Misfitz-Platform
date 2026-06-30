"use client";

import { useThemeMode } from "@/components/theme/ThemeProvider";
import type { HeldCollection } from "@/lib/portfolio/myHoldings";

// Right-side collection picker for Your Binder — mirrors the collection page's switcher, but filters
// the binder in place instead of navigating. "All" shows everything; picking one scopes the binder
// (and reveals trait filters). Each collection has an eye toggle to hide it from the binder; hidden
// collections drop into a muted section at the bottom and can be restored from there.
const ACCENTS = ["#8b5cf6", "#ff6eb4", "#00d4ff", "#5fce7a", "#f59e0b", "#a855f7", "#f87171", "#38bdf8"];

function EyeIcon({ off, color }: { off: boolean; color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {off ? (
        <>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <path d="M6.61 6.61A18.45 18.45 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function BinderCollectionPicker({
  collections,
  totalCount,
  selectedId,
  onSelect,
  hiddenIds,
  onToggleHide,
}: {
  collections: HeldCollection[];
  totalCount: number;
  selectedId: string;
  onSelect: (id: string) => void;
  hiddenIds: Set<string>;
  onToggleHide: (id: string) => void;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  // Keep each collection's colour stable regardless of how the visible/hidden split shuffles rows.
  const accentFor = (id: string) => {
    const idx = collections.findIndex((c) => c.id === id);
    return ACCENTS[(idx + 1) % ACCENTS.length];
  };

  const visible = collections.filter((c) => !hiddenIds.has(c.id));
  const hidden = collections.filter((c) => hiddenIds.has(c.id));

  const row = (id: string, name: string, count: number, accent: string, canHide: boolean) => {
    const active = selectedId === id;
    return (
      <div key={id} className="group relative min-w-0">
        <button
          type="button"
          onClick={() => onSelect(id)}
          className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-all"
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
              className="truncate pr-4 text-[11px] font-bold leading-tight"
              style={{ color: active ? accent : isLight ? "#2a3a55" : "rgba(255,255,255,0.65)" }}
            >
              {name}
            </div>
            <div className="mt-0.5 truncate text-[9px] font-semibold" style={{ color: isLight ? "#6b8db0" : "rgba(255,255,255,0.4)" }}>
              {count.toLocaleString()} NFTs
            </div>
          </div>
        </button>
        {canHide && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleHide(id); }}
            title="Hide from binder"
            aria-label={`Hide ${name} from binder`}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            style={{ background: isLight ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.45)" }}
          >
            <EyeIcon off={false} color={isLight ? "#6b8db0" : "rgba(255,255,255,0.6)"} />
          </button>
        )}
      </div>
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
        {row("all", "All collections", totalCount, "#8b5cf6", false)}
        {visible.map((c) => row(c.id, c.name, c.count, accentFor(c.id), true))}
      </div>

      {hidden.length > 0 && (
        <div className="mt-2 border-t pt-2" style={{ borderColor: isLight ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.06)" }}>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-subtle">
            Hidden · {hidden.length}
          </div>
          <div className="flex flex-col gap-1">
            {hidden.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ opacity: 0.55 }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-bold leading-tight" style={{ color: isLight ? "#2a3a55" : "rgba(255,255,255,0.6)" }}>
                    {c.name}
                  </div>
                  <div className="mt-0.5 truncate text-[9px] font-semibold" style={{ color: isLight ? "#6b8db0" : "rgba(255,255,255,0.4)" }}>
                    {c.count.toLocaleString()} NFTs · hidden
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHide(c.id)}
                  title="Show in binder"
                  aria-label={`Show ${c.name} in binder`}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                  style={{ border: isLight ? "1px solid rgba(100,180,255,0.3)" : "1px solid rgba(255,255,255,0.12)" }}
                >
                  <EyeIcon off color={isLight ? "#6b8db0" : "rgba(255,255,255,0.55)"} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
