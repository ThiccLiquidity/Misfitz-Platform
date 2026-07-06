"use client";

import { useEffect, useState } from "react";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// A consistent, always-visible "the site is working" bar. Fixed to the bottom so it shows on any
// data-heavy view whenever we're loading a collection, streaming per-NFT traits/ranks, or warming a
// background model. Give it `active`, a short `label`, and an optional 0..1 `progress`:
//   • progress known  -> a determinate bar that FILLS to the % (with a soft moving sheen)
//   • progress unknown -> a smooth sliding bar (indeterminate) — never a bare spinner, which reads as
//     "frozen/broken". Renders nothing when inactive (after a brief linger to avoid flicker).
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
  // Linger briefly after work stops so the quick gaps BETWEEN enrichment batches don't flicker it in and
  // out. The last label/progress are held during the linger.
  const [visible, setVisible] = useState(active);
  const [shown, setShown] = useState({ label, progress });
  useEffect(() => {
    if (active) { setVisible(true); setShown({ label, progress }); return; }
    const t = setTimeout(() => setVisible(false), 800);
    return () => clearTimeout(t);
  }, [active, label, progress]);
  if (!visible) return null;

  const hasPct = typeof shown.progress === "number";
  const pct = hasPct ? Math.round(Math.max(0, Math.min(1, shown.progress as number)) * 100) : null;

  const accent = isLight ? "#2980c8" : "#f0c040";
  const accent2 = isLight ? "#5ab0e8" : "#ffe08a";
  const track = isLight ? "rgba(41,128,200,0.16)" : "rgba(240,192,64,0.16)";

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[70] w-[min(92vw,340px)] -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      role="status"
      aria-live="polite"
    >
      <style>{`
        @keyframes wi-slide { 0%{transform:translateX(-120%)} 100%{transform:translateX(320%)} }
        @keyframes wi-shine { 0%{background-position:-180px 0} 100%{background-position:180px 0} }
        @keyframes wi-pulse { 0%,100%{opacity:.45;transform:scale(.85)} 50%{opacity:1;transform:scale(1)} }
      `}</style>
      <div
        className="flex flex-col gap-2 rounded-2xl px-4 py-3 shadow-2xl"
        style={{
          background: isLight ? "rgba(255,255,255,0.97)" : "rgba(20,16,10,0.97)",
          border: `1.5px solid ${isLight ? "rgba(41,128,200,0.5)" : "rgba(240,192,64,0.5)"}`,
          color: isLight ? "#0a1e38" : "#f0d9a0",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: accent, animation: "wi-pulse 1.2s ease-in-out infinite" }}
            />
            <span className="truncate">{shown.label}</span>
          </span>
          {pct !== null && (
            <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: accent }}>{pct}%</span>
          )}
        </div>

        {/* Progress track */}
        <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: track }}>
          {hasPct ? (
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${accent}, ${accent2})`,
                backgroundSize: "180px 100%",
                animation: "wi-shine 1.1s linear infinite",
              }}
            />
          ) : (
            <div
              className="absolute inset-y-0 left-0 w-1/3 rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${accent}, ${accent2}, transparent)`,
                animation: "wi-slide 1.25s cubic-bezier(0.4,0,0.2,1) infinite",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
