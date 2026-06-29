"use client";

import { useThemeMode } from "@/components/theme/ThemeProvider";

interface BinderPageControlsProps {
  pageIndex: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  disabled: boolean;
}

// Fat rounded SVG chevron — strokeWidth 5.5 gives a cartoonish chunkiness
function ChevronIcon({ direction, color }: { direction: "prev" | "next"; color: string }) {
  const d = direction === "next" ? "M8 4l8 8-8 8" : "M16 4l-8 8 8 8";
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke={color} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowButton({
  direction,
  onClick,
  enabled,
  label,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  enabled: boolean;
  label: string;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  // Cloud-white pillowy style for light mode; deep sky-blue for dark mode
  const activeBg = isLight
    ? "linear-gradient(160deg, #ffffff 0%, #e2f0ff 40%, #b8d8ff 100%)"
    : "linear-gradient(160deg, #3366ee 0%, #1a44d4 45%, #0d28a6 100%)";

  const activeShadow = isLight
    ? [
        "0 10px 28px rgba(40,110,255,0.32)",
        "0 4px 10px rgba(0,0,80,0.14)",
        "inset 0 4px 10px rgba(255,255,255,0.98)",
        "inset 0 -4px 8px rgba(80,140,255,0.32)",
      ].join(", ")
    : [
        "0 10px 28px rgba(30,80,255,0.55)",
        "0 4px 10px rgba(0,0,0,0.45)",
        "inset 0 3px 8px rgba(140,190,255,0.45)",
        "inset 0 -3px 7px rgba(0,20,120,0.55)",
      ].join(", ");

  const hoverShadow = isLight
    ? [
        "0 16px 38px rgba(40,110,255,0.45)",
        "0 6px 14px rgba(0,0,80,0.2)",
        "inset 0 4px 10px rgba(255,255,255,0.98)",
        "inset 0 -4px 8px rgba(80,140,255,0.38)",
      ].join(", ")
    : [
        "0 16px 38px rgba(30,80,255,0.7)",
        "0 6px 14px rgba(0,0,0,0.5)",
        "inset 0 3px 8px rgba(140,190,255,0.5)",
        "inset 0 -3px 7px rgba(0,20,120,0.6)",
      ].join(", ");

  const pressShadow = isLight
    ? [
        "0 4px 12px rgba(40,110,255,0.25)",
        "inset 0 2px 6px rgba(255,255,255,0.9)",
        "inset 0 -2px 5px rgba(80,140,255,0.28)",
      ].join(", ")
    : [
        "0 4px 12px rgba(30,80,255,0.4)",
        "inset 0 2px 5px rgba(140,190,255,0.35)",
        "inset 0 -2px 5px rgba(0,20,120,0.5)",
      ].join(", ");

  const arrowColor = enabled
    ? isLight ? "#1133bb" : "#ffffff"
    : isLight ? "rgba(60,80,140,0.25)" : "rgba(255,255,255,0.18)";

  function onEnter(e: React.MouseEvent<HTMLButtonElement>) {
    if (!enabled) return;
    Object.assign(e.currentTarget.style, {
      transform: "translateY(-4px) scale(1.09)",
      boxShadow: hoverShadow,
      filter: "brightness(1.05)",
    });
  }
  function onLeave(e: React.MouseEvent<HTMLButtonElement>) {
    if (!enabled) return;
    Object.assign(e.currentTarget.style, {
      transform: "translateY(0) scale(1)",
      boxShadow: activeShadow,
      filter: "brightness(1)",
    });
  }
  function onDown(e: React.MouseEvent<HTMLButtonElement>) {
    if (!enabled) return;
    Object.assign(e.currentTarget.style, {
      transform: "translateY(2px) scale(0.94)",
      boxShadow: pressShadow,
      filter: "brightness(0.94)",
    });
  }
  function onUp(e: React.MouseEvent<HTMLButtonElement>) {
    if (!enabled) return;
    Object.assign(e.currentTarget.style, {
      transform: "translateY(-4px) scale(1.09)",
      boxShadow: hoverShadow,
      filter: "brightness(1.05)",
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={label}
      style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        border: "none",
        outline: "none",
        cursor: enabled ? "pointer" : "not-allowed",
        background: enabled ? activeBg : isLight ? "rgba(180,190,210,0.25)" : "rgba(80,90,120,0.2)",
        boxShadow: enabled ? activeShadow : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "transform 0.13s ease, box-shadow 0.13s ease, filter 0.13s ease",
        opacity: enabled ? 1 : 0.32,
        userSelect: "none",
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={onDown}
      onMouseUp={onUp}
    >
      <ChevronIcon direction={direction} color={arrowColor} />
    </button>
  );
}

export function BinderPageControls({
  pageIndex,
  pageCount,
  onPrev,
  onNext,
  disabled,
}: BinderPageControlsProps) {
  const canPrev = !disabled && pageIndex > 0;
  const canNext = !disabled && pageIndex < pageCount - 1;

  return (
    <div className="flex items-center justify-center gap-8 py-5">
      <ArrowButton direction="prev" onClick={onPrev} enabled={canPrev} label="Previous page" />
      <span
        className="text-subtle"
        style={{ fontWeight: 700, fontSize: 16, letterSpacing: "0.06em", minWidth: 80, textAlign: "center" }}
      >
        {pageIndex + 1} / {pageCount}
      </span>
      <ArrowButton direction="next" onClick={onNext} enabled={canNext} label="Next page" />
    </div>
  );
}
