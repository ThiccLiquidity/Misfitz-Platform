"use client";

import { useEffect, useRef, useState } from "react";

// A consistent, always-visible "the site is working" bar.
//
// THE RULE: it always moves. A bar that sits still reads as "frozen/broken" even when the server is working
// hard — that perception was the whole complaint, and a spinner is the worst version of it because it looks
// identical at 5% and 95%.
//
// So the displayed value is HONEST BUT ALWAYS CREEPING:
//   * Real progress is respected immediately and the bar NEVER goes backwards.
//   * Between real updates it eases toward a ceiling a little above the real value, so a stalled scan keeps
//     inching instead of freezing — but it can never reach 100% until the work is genuinely finished.
//   * With no real signal at all it eases toward 92% on elapsed time, which is still movement and still
//     never lies about being done.
//   * When the work completes it snaps to 100% so the end is unambiguous.
const TICK_MS = 250;
const EASE = 0.06;          // fraction of the remaining gap closed per tick
const MIN_STEP = 0.0008;    // ...but always move at least this much, so it never LOOKS stopped
const REAL_HEADROOM = 0.35; // creep this far into the gap above a known real value
const REAL_CEILING = 0.995; // never claim done on a guess
const BLIND_CEILING = 0.92; // with no signal at all, stop well short of 100%

function useCreepingProgress(active: boolean, real: number | undefined): number {
  const [display, setDisplay] = useState(0);
  const ref = useRef(0);
  const realRef = useRef<number | undefined>(real);
  realRef.current = real;

  useEffect(() => {
    if (!active) {
      // Finished: snap to full so completion is unambiguous, then let the parent's linger fade it out.
      ref.current = 1;
      setDisplay(1);
      return;
    }
    ref.current = 0;
    setDisplay(0);
    const t = setInterval(() => {
      const r = realRef.current;
      const hasReal = typeof r === "number" && Number.isFinite(r);
      const floor = hasReal ? Math.max(0, Math.min(1, r as number)) : 0;
      if (floor >= 1) { ref.current = 1; setDisplay(1); return; }
      const ceiling = hasReal ? Math.min(REAL_CEILING, floor + (1 - floor) * REAL_HEADROOM) : BLIND_CEILING;
      // Real progress wins instantly and is a floor — the bar never rewinds.
      let next = Math.max(ref.current, floor);
      if (next < ceiling) next = Math.min(ceiling, Math.max(next + MIN_STEP, next + (ceiling - next) * EASE));
      if (next !== ref.current) { ref.current = next; setDisplay(next); }
    }, TICK_MS);
    return () => clearInterval(t);
  }, [active]);

  return display;
}

export function WorkingIndicator({
  active,
  label,
  progress,
}: {
  active: boolean;
  label: string;
  /** Real 0..1 progress when it's known. Omit it and the bar creeps on elapsed time instead. */
  progress?: number;
}) {
  // Linger briefly after work stops so the quick gaps BETWEEN enrichment batches don't flicker it in and out.
  const [visible, setVisible] = useState(active);
  const [shownLabel, setShownLabel] = useState(label);
  useEffect(() => {
    if (active) { setVisible(true); setShownLabel(label); return; }
    const t = setTimeout(() => setVisible(false), 800);
    return () => clearTimeout(t);
  }, [active, label]);

  const value = useCreepingProgress(active, progress);
  if (!visible) return null;

  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const accent = "#f0c040";
  const accent2 = "#ffe08a";
  const track = "rgba(240,192,64,0.16)";

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[70] w-[min(92vw,340px)] -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      role="status"
      aria-live="polite"
    >
      <style>{`
        @keyframes wi-shine { 0%{background-position:-180px 0} 100%{background-position:180px 0} }
        @keyframes wi-pulse { 0%,100%{opacity:.45;transform:scale(.85)} 50%{opacity:1;transform:scale(1)} }
      `}</style>
      <div
        className="flex flex-col gap-2 rounded-2xl px-4 py-3 shadow-2xl"
        style={{ background: "rgba(20,16,10,0.97)", border: "1.5px solid rgba(240,192,64,0.5)", color: "#f0d9a0" }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent, animation: "wi-pulse 1.2s ease-in-out infinite" }} />
            <span className="truncate">{shownLabel}</span>
          </span>
          <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: accent }}>{pct}%</span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: track }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${accent}, ${accent2})`,
              backgroundSize: "180px 100%",
              animation: "wi-shine 1.1s linear infinite",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// Inline version for route-level loading shells and in-panel waits, where a fixed bottom-right toast would
// be wrong. Same creep rule — these have no progress signal at all (they render before any data arrives),
// which is exactly the case a spinner handled worst.
export function LoadingBar({ label, className = "" }: { label: string; className?: string }) {
  const value = useCreepingProgress(true, undefined);
  const pct = Math.round(value * 100);
  const accent = "var(--gold, #f0c040)";
  return (
    <div className={`w-full max-w-sm ${className}`} role="status" aria-live="polite">
      <style>{`@keyframes lb-shine { 0%{background-position:-160px 0} 100%{background-position:160px 0} }`}</style>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-semibold opacity-90">{label}</span>
        <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: accent }}>{pct}%</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--gold, #f0c040) 16%, transparent)" }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 55%, white))`,
            backgroundSize: "160px 100%",
            animation: "lb-shine 1.1s linear infinite",
          }}
        />
      </div>
    </div>
  );
}
