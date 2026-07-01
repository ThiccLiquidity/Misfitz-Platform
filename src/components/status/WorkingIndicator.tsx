"use client";

import { useThemeMode } from "@/components/theme/ThemeProvider";

// A consistent, always-visible "the site is working" pill. Fixed to the bottom-right so it shows on
// any data-heavy view whenever we're loading a collection, streaming per-NFT traits/ranks, or warming
// a background model (sales curve / our own rarity table). Give it `active`, a short `label`, and an
// optional 0..1 `progress`. Renders nothing when inactive.
export function WorkingIndicator({
  active,
  label,
  progress,
}: {
  active: boolean;
  label: string;
  progress?: number;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  if (!active) return null;

  const pct = typeof progress === "number" ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[70] flex items-center gap-2.5 rounded-full py-2 pl-2.5 pr-4 text-sm font-semibold shadow-lg"
      style={{
        background: isLight ? "rgba(255,255,255,0.96)" : "rgba(20,16,10,0.94)",
        border: isLight ? "1px solid rgba(41,128,200,0.35)" : "1px solid rgba(240,192,64,0.35)",
        color: isLight ? "#0a1e38" : "#f0d9a0",
        backdropFilter: "blur(8px)",
      }}
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full"
        style={{ border: `2px solid ${isLight ? "rgba(41,128,200,0.35)" : "rgba(240,192,64,0.35)"}`, borderTopColor: "transparent" }}
      />
      <span className="whitespace-nowrap">
        {label}
        {pct !== null ? ` · ${pct}%` : ""}
      </span>
    </div>
  );
}
