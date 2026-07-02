"use client";

import { useEffect } from "react";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Reusable mobile filter bottom-sheet (shared by the collection shop, the collection binder, and the
// wallet binder). Renders a backdrop + slide-up panel with a drag handle, a titled header, and whatever
// filter content the caller passes as children (typically <FilterSidebar sheet />). Tap the backdrop or
// the ✕ to dismiss. Keeps the mobile filter UX identical everywhere.
export function MobileFilterSheet({
  open,
  onClose,
  title = "Filters",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" style={{ backdropFilter: "blur(4px)" }} />
      <div
        className="relative overflow-y-auto rounded-t-2xl"
        style={{
          maxHeight: "85vh",
          paddingBottom: "env(safe-area-inset-bottom)",
          background: isLight ? "rgba(255,255,255,0.98)" : "rgba(22,20,30,0.98)",
          border: isLight ? "1px solid rgba(100,180,255,0.30)" : "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          boxShadow: isLight ? "0 -8px 40px rgba(0,80,160,0.14)" : "0 -8px 40px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full" style={{ background: isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.22)" }} />
        </div>
        <div
          className="sticky top-0 flex items-center justify-between px-4 py-2"
          style={{
            background: isLight ? "rgba(255,255,255,0.98)" : "rgba(22,20,30,0.98)",
            borderBottom: isLight ? "1px solid rgba(100,180,255,0.18)" : "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <span className="text-sm font-black uppercase tracking-widest" style={{ color: isLight ? "#1a3a7a" : "rgba(255,255,255,0.80)" }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-10 w-10 items-center justify-center text-base font-bold transition-opacity hover:opacity-60"
            style={{ color: isLight ? "#666" : "rgba(255,255,255,0.45)" }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// The mobile "Filters" trigger button — consistent across pages. Shows a count badge when filters are
// active so it's obvious something is applied.
export function MobileFilterButton({ onClick, activeCount = 0 }: { onClick: () => void; activeCount?: number }) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const on = activeCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg px-4 text-xs font-bold"
      style={{
        minHeight: 40,
        border: on
          ? isLight ? "1.5px solid rgba(60,120,220,0.6)" : "1.5px solid rgba(140,160,255,0.5)"
          : isLight ? "1.5px solid rgba(60,120,220,0.25)" : "1.5px solid rgba(255,255,255,0.14)",
        background: on
          ? isLight ? "rgba(40,100,220,0.12)" : "rgba(120,140,255,0.15)"
          : isLight ? "rgba(10,30,80,0.06)" : "rgba(18,16,28,0.97)",
        color: on ? (isLight ? "#1144cc" : "#a0b4ff") : (isLight ? "#0a1e50" : "rgba(255,255,255,0.70)"),
      }}
    >
      {on ? `Filters (${activeCount})` : "Filters"}
    </button>
  );
}
