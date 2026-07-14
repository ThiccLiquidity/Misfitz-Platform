"use client";

import { useThemeMode } from "@/components/theme/ThemeProvider";
import type { HeldCollection } from "@/lib/portfolio/myHoldings";

// Right-side collection picker for Your Binder â mirrors the collection page's switcher, but filters
// the binder in place instead of navigating. "All" shows everything; picking one scopes the binder
// (and reveals trait filters). Each collection has an eye toggle to hide it from the binder; hidden
// collections drop into a muted section at the bottom and can be restored from there.
// Vault styling: one gold language (no per-collection rainbow) on a .tf-panel surface.

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

  const visible = collections.filter((c) => !hiddenIds.has(c.id));
  const hidden = collections.filter((c) => hiddenIds.has(c.id));

  const row = (id: string, name: string, count: number, canHide: boolean) => {
    const active = selectedId === id;
    return (
      <div key={id} className="group relative min-w-0">
        <button
          type="button"
          onClick={() => onSelect(id)}
          className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--gold)_7%,transparent)]"
          style={{
            background: active ? "color-mix(in srgb, var(--gold) 12%, transparent)" : undefined,
            border: active ? "1px solid color-mix(in srgb, var(--gold) 55%, transparent)" : "1px solid transparent",
            boxShadow: active ? "0 0 12px color-mix(in srgb, var(--gold) 20%, transparent)" : "none",
          }}
        >
          <div
            className="flex-shrink-0 rounded-sm"
            style={{
              width: 6, height: 38, flexShrink: 0,
              background: active
                ? "linear-gradient(180deg, var(--gold), color-mix(in srgb, var(--gold) 55%, transparent))"
                : "color-mix(in srgb, var(--gold) 30%, transparent)",
            }}
          />
          <div className="min-w-0">
            <div className="truncate pr-4 text-[11px] font-bold leading-tight" style={{ color: active ? "var(--title)" : "var(--subtle)" }}>
              {name}
            </div>
            <div className="text-subtle mt-0.5 truncate text-[9px] font-semibold" style={{ opacity: 0.7 }}>
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
    <div className="tf-panel sticky top-4 flex flex-shrink-0 flex-col gap-1 rounded-xl p-3" style={{ width: 248 }}>
      <div className="text-subtle mb-1 text-[10px] font-semibold uppercase tracking-widest">Collections</div>
      <div className="tf-hairline mb-2" aria-hidden />
      <div className="grid grid-cols-2 gap-1.5 overflow-y-auto" style={{ maxHeight: 470 }}>
        {row("all", "All collections", totalCount, false)}
        {visible.map((c) => row(c.id, c.name, c.count, true))}
      </div>

      {hidden.length > 0 && (
        <div className="mt-2 border-t pt-2" style={{ borderColor: isLight ? "rgba(41,128,200,0.25)" : "rgba(201,162,39,0.18)" }}>
          <div className="text-subtle mb-1.5 text-[10px] font-semibold uppercase tracking-widest">
            Hidden · {hidden.length}
          </div>
          <div className="flex flex-col gap-1">
            {hidden.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ opacity: 0.55 }}>
                <div className="min-w-0 flex-1">
                  <div className="text-subtle truncate text-[11px] font-bold leading-tight">{c.name}</div>
                  <div className="text-subtle mt-0.5 truncate text-[9px] font-semibold" style={{ opacity: 0.7 }}>
                    {c.count.toLocaleString()} NFTs · hidden
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleHide(c.id)}
                  title="Show in binder"
                  aria-label={`Show ${c.name} in binder`}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                  style={{ border: isLight ? "1px solid rgba(41,128,200,0.3)" : "1px solid rgba(201,162,39,0.25)" }}
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
