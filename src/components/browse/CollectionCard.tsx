"use client";

import Image from "next/image";
import Link from "next/link";
import type { CollectionSummary } from "@/types";
import { formatXch, formatXchShort } from "@/lib/format";
import { memo } from "react";
import { TangBadge } from "@/components/tang/TangBadge";

// One collection tile on the /browse discovery grid. Tapping it opens the live collection binder.
// "Vault tile" styling lives in .tf-tile / .tf-tile-foot (globals.css) and themes itself (warm gold
// vault in dark, clean white + sky border in light), so this component carries no isLight branching.
// `hot` marks the hottest trending tiles with a flame chip (top-right; TangBadge owns top-left).
function CollectionCardImpl({ c, hot = false }: { c: CollectionSummary; hot?: boolean }) {
  return (
    <Link href={`/collection/${c.id}`} className="tf-tile group flex flex-col overflow-hidden">
      <div className="relative aspect-square overflow-hidden" style={{ background: "var(--art-bg)" }}>
        <TangBadge colId={c.id} variant="corner" />
        {hot && <span className="tf-heat" role="img" aria-label="Hot — trending by volume" title="Hot — trending by volume">🔥</span>}
        {c.imageUrl ? (
          <Image
            src={c.imageUrl}
            alt={c.name}
            fill
            className="object-cover transition duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 50vw, 220px"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl" style={{ color: "#7a6038" }}>◈</div>
        )}
      </div>
      <div className="tf-tile-foot flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1">
          <span className="text-title truncate text-[13px] font-extrabold tracking-tight">{c.name}</span>
          {c.verified && <span className="shrink-0" style={{ color: "var(--gold)" }} title="Verified creator">✔</span>}
        </div>
        <div className="text-subtle text-[10.5px] uppercase tracking-wide opacity-80">{c.totalSupply.toLocaleString()} items</div>
        <div className="mt-1.5 flex items-end justify-between">
          <span className="flex flex-col leading-none">
            <span className="text-subtle text-[9px] font-bold uppercase tracking-widest">Floor</span>
            <span className="mt-1 text-[13px] font-black tabular-nums" style={{ color: "var(--gold)" }}>
              {c.floorXch != null ? formatXch(c.floorXch) : "—"}
            </span>
          </span>
          <span className="flex flex-col items-end leading-none">
            <span className="text-subtle text-[9px] font-bold uppercase tracking-widest">Vol</span>
            <span className="text-subtle mt-1 text-[11px] tabular-nums">
              {c.volumeXch != null ? formatXchShort(c.volumeXch) : "—"}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}

// Memoized: browse grid tiles only re-render when their collection data changes (e.g. not on every
// keystroke in the search box, which re-renders the parent).
export const CollectionCard = memo(CollectionCardImpl);
