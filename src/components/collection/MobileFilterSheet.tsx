"use client";

import { useEffect } from "react";

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
        className="tf-sheet relative overflow-y-auto rounded-t-2xl"
        style={{
          maxHeight: "85vh",
          paddingBottom: "env(safe-area-inset-bottom)",
          background: "rgba(36,26,16,0.98)",
          border: "1px solid rgba(201,162,39,0.30)",
          borderBottom: "none",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full" style={{ background: "rgba(201,162,39,0.35)" }} />
        </div>
        <div
          className="sticky top-0 flex items-center justify-between px-4 py-2"
          style={{
            background: "rgba(36,26,16,0.98)",
            borderBottom: "1px solid rgba(201,162,39,0.18)",
          }}
        >
          <span className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--title)" }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-10 w-10 items-center justify-center text-base font-bold transition-opacity hover:opacity-60"
            style={{ color: "rgba(255,255,255,0.45)" }}
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
  const on = activeCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg px-4 text-xs font-bold"
      style={{
        minHeight: 40,
        border: on
          ? "1.5px solid rgba(201,162,39,0.6)"
          : "1.5px solid rgba(201,162,39,0.25)",
        background: on
          ? "rgba(201,162,39,0.14)"
          : "rgba(46,32,20,0.55)",
        color: on ? "var(--gold)" : "var(--subtle)",
      }}
    >
      {on ? `Filters (${activeCount})` : "Filters"}
    </button>
  );
}
