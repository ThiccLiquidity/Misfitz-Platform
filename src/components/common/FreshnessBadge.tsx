"use client";

import { useEffect, useState } from "react";

// "Values live · updated 2m ago" — a small trust signal so a value that moves reads as intentional, not
// buggy. `asOf` is the ms-epoch the displayed values were last (re)built (comps model / value index). With
// the event-driven refresh (Phase 1) an actively-viewed collection updates within seconds of a sale, so
// this badge is how the user SEES that freshness. Purely cosmetic — no data fetching of its own.

function rel(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function FreshnessBadge({ asOf, light = false }: { asOf?: number | null; light?: boolean }) {
  // Re-render every 30s so the relative time stays honest without a prop change.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const label = asOf ? `updated ${rel(asOf)}` : "watching for sales";
  const dot = light ? "#16a34a" : "#22c55e";
  const text = light ? "#166534" : "#86efac";
  const bg = light ? "rgba(22,163,74,0.10)" : "rgba(34,197,94,0.12)";
  const border = light ? "rgba(22,163,74,0.25)" : "rgba(34,197,94,0.22)";

  return (
    <span
      title="Values refresh automatically as new sales land on Dexie. This shows when they were last recomputed."
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: bg, color: text, border: `1px solid ${border}` }}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: dot }} />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      </span>
      <span className="tabular-nums">Live · {label}</span>
    </span>
  );
}
