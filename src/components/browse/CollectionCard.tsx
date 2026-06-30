"use client";

import Image from "next/image";
import Link from "next/link";
import type { CollectionSummary } from "@/types";
import { formatXch } from "@/lib/format";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// One collection tile on the /browse discovery grid. Tapping it opens the live collection binder.
// Light mode gets a solid white card + sky-blue border (the old white/3 glass vanished on the light
// page); dark mode keeps the glassy look.
export function CollectionCard({ c }: { c: CollectionSummary }) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  return (
    <Link
      href={`/collection/${c.id}`}
      className={`group flex flex-col overflow-hidden rounded-xl border transition ${
        isLight
          ? "border-sky-600/35 bg-white shadow-sm hover:border-sky-600/60 hover:shadow-md"
          : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
      }`}
    >
      <div className={`relative aspect-square overflow-hidden ${isLight ? "bg-sky-50" : "bg-white/5"}`}>
        {c.imageUrl ? (
          <Image
            src={c.imageUrl}
            alt={c.name}
            fill
            className="object-cover transition duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 50vw, 220px"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl opacity-30">◈</div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1">
          <span className="text-title truncate text-sm font-bold">{c.name}</span>
          {c.verified && <span className={isLight ? "text-sky-600" : "text-sky-400"} title="Verified creator">✔</span>}
        </div>
        <div className="text-subtle text-[11px]">{c.totalSupply.toLocaleString()} items</div>
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className="text-subtle">
            Floor <span className="text-title font-semibold">{c.floorXch != null ? formatXch(c.floorXch) : "—"}</span>
          </span>
          <span className="text-subtle">
            Vol <span className="text-title font-semibold">{c.volumeXch != null ? formatXch(Math.round(c.volumeXch)) : "—"}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
