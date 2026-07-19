"use client";

import Image from "next/image";
import { useState } from "react";
import type { SaleFeedItem } from "@/lib/collections/liveCollection";
import { formatXchShort, timeAgo } from "@/lib/format";

// A collapsible horizontal strip of the collection's most recent sales, shown between the header and the
// tier-stats bar. Each chip is clickable → opens the shareable SOLD showcase. Data is a pure join already
// computed server-side (getCollectionRecentSales); this component only renders + routes clicks. Collapses
// to save vertical space on mobile; remembers nothing (cheap, stateless beyond open/closed).
export function RecentSalesRail({
  sales,
  onOpen,
  light = false,
}: {
  sales: SaleFeedItem[];
  onOpen: (s: SaleFeedItem) => void;
  light?: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (!sales || sales.length === 0) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border"
      style={{ borderColor: "color-mix(in srgb, var(--gold) 22%, transparent)", background: "color-mix(in srgb, var(--gold) 5%, transparent)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2"
      >
        <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider" style={{ color: light ? "#047857" : "var(--gold)" }}>
          <span aria-hidden>💸</span> Recent sales
          <span className="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums" style={{ background: "color-mix(in srgb, var(--gold) 14%, transparent)", color: light ? "#33566e" : "#e8cf94" }}>{sales.length}</span>
        </span>
        <span className="text-xs" style={{ color: "var(--subtle)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="flex gap-2 overflow-x-auto px-3.5 pb-3 pt-0.5" style={{ scrollbarWidth: "thin" }}>
          {sales.map((s) => (
            <button
              key={`${s.launcherId}-${s.date}`}
              type="button"
              onClick={() => onOpen(s)}
              title={`${s.name} — sold for ${formatXchShort(s.priceXch)} XCH ${timeAgo(s.date)}`}
              className="group flex w-[112px] flex-shrink-0 flex-col overflow-hidden rounded-lg text-left transition-transform hover:-translate-y-0.5"
              style={{ background: "color-mix(in srgb, var(--card-border) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--card-border) 30%, transparent)" }}
            >
              <div className="relative aspect-square w-full overflow-hidden" style={{ background: "#05080f" }}>
                {s.thumb ? (
                  <Image src={s.thumb} alt={s.name} fill className="object-cover" sizes="112px" unoptimized />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl" style={{ color: "rgba(255,224,106,0.3)" }}>◈</div>
                )}
                {s.rank != null && (
                  <span className="absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-black tabular-nums"
                    style={{ background: "rgba(3,7,14,0.7)", color: "var(--gold)" }}>#{s.rank}</span>
                )}
              </div>
              <div className="px-2 py-1.5">
                <div className="truncate text-[11px] font-bold" style={{ color: "var(--title)" }}>{s.name}</div>
                <div className="mt-0.5 flex items-baseline justify-between gap-1">
                  <span className="text-xs font-black tabular-nums" style={{ color: light ? "#047857" : "var(--gold)" }}>{formatXchShort(s.priceXch)}</span>
                  <span className="text-[9px] font-semibold" style={{ color: "var(--subtle)" }}>{timeAgo(s.date)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
