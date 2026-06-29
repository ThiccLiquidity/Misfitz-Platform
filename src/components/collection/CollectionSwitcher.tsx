"use client";

import Link from "next/link";
import type { CollectionData } from "@/types";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Enough coming-soon slots to fill the panel with something to look at.
const PREVIEW_SLOTS = [
  { name: "Chia Cats",      accent: "#ff6eb4" },
  { name: "Pixel Punks",    accent: "#00d4ff" },
  { name: "Space Beans",    accent: "#5fce7a" },
  { name: "Void Walkers",   accent: "#a855f7" },
  { name: "Degen Frogs",    accent: "#f59e0b" },
];

interface CollectionSwitcherProps {
  collections: CollectionData[];
  currentSlug: string;
}

export function CollectionSwitcher({ collections, currentSlug }: CollectionSwitcherProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  // Show enough previews to make the panel feel populated (max 5 extras)
  const previewCount = Math.min(5, Math.max(0, 6 - collections.length));
  const previews = PREVIEW_SLOTS.slice(0, previewCount);

  return (
    <div
      className="flex flex-col gap-1 flex-shrink-0 rounded-xl p-3 sticky top-4"
      style={{
        width: 168,
        background: isLight
          ? "rgba(255,255,255,0.72)"
          : "linear-gradient(175deg, #1e1e22 0%, #121214 100%)",
        border: isLight
          ? "1px solid rgba(100, 180, 255, 0.35)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isLight
          ? "0 4px 24px rgba(0, 80, 160, 0.12), inset 0 1px 0 rgba(255,255,255,0.8)"
          : "0 4px 24px rgba(0,0,0,0.4)",
        backdropFilter: isLight ? "blur(12px)" : undefined,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between mb-2 pb-2 border-b"
        style={{ borderColor: isLight ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.05)" }}
      >
        <span className={isLight ? "sb-section-label" : "text-[10px] font-semibold uppercase tracking-widest text-subtle"}>
          Collections
        </span>
        <Link
          href="/"
          className="text-[10px] text-subtle/60 hover:text-subtle transition-colors"
        >
          ← All
        </Link>
      </div>

      {/* Live collections */}
      {collections.map((c) => {
        const isActive = c.slug === currentSlug;
        const accent = c.theme?.accent ?? "#888888";
        return (
          <Link
            key={c.slug}
            href={`/collections/${c.slug}`}
            className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-all"
            style={{
              background: isActive
                ? `linear-gradient(135deg, ${accent}20, ${accent}10)`
                : isLight
                ? `linear-gradient(135deg, ${accent}0a, transparent)`
                : "transparent",
              border: `1px solid ${isActive ? `${accent}55` : isLight ? `${accent}33` : "transparent"}`,
              boxShadow: isActive ? `0 0 12px ${accent}33` : "none",
            }}
          >
            {/* Mini binder spine */}
            <div
              className="flex-shrink-0 rounded-sm"
              style={{
                width: 7,
                height: 44,
                background: `linear-gradient(180deg, ${accent}ee 0%, ${accent}99 100%)`,
                boxShadow: isActive ? `0 0 10px ${accent}66` : `0 0 0 ${accent}00`,
                transition: "box-shadow 0.2s",
              }}
            />

            {/* Name + count */}
            <div className="min-w-0">
              <div
                className={isLight ? "cs-coll-name text-[12px] font-black truncate leading-tight" : "text-[11px] font-bold truncate leading-tight"}
                style={{
                  color: isLight ? undefined : isActive ? accent : "rgba(255,255,255,0.65)",
                  // gradient text applied via CSS class cs-coll-name in light mode
                  // but we still need a fallback color for SSR / non-webkit
                  ...(isLight ? {} : {}),
                }}
                data-accent={isLight ? accent : undefined}
              >
                {c.name}
              </div>
              <div
                className="text-[9px] mt-0.5 truncate font-semibold"
                style={{ color: isLight ? "#6b8db0" : undefined }}
              >
                {c.nftCount.toLocaleString()} NFTs
              </div>
            </div>
          </Link>
        );
      })}

      {/* Coming-soon slots */}
      {previews.map((p) => (
        <div
          key={p.name}
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg opacity-40 cursor-default"
        >
          <div
            className="flex-shrink-0 rounded-sm"
            style={{
              width: 7,
              height: 44,
              background: `linear-gradient(180deg, ${p.accent}88 0%, ${p.accent}44 100%)`,
            }}
          />
          <div className="min-w-0">
            <div
              className="text-[11px] font-bold truncate leading-tight"
              style={{ color: isLight ? "#9ab5d0" : "rgba(255,255,255,0.5)" }}
            >
              {p.name}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: isLight ? "#b0c8e0" : undefined }}>Coming soon</div>
          </div>
        </div>
      ))}

      {/* Footer */}
      <div
        className="mt-auto pt-3 border-t"
        style={{ borderColor: isLight ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.05)" }}
      >
        <button
          type="button"
          className="w-full rounded-lg py-1.5 text-[10px] font-semibold transition-all"
          style={{
            color: isLight ? "#2980c8" : undefined,
            border: isLight ? "1px solid rgba(41,180,255,0.35)" : "1px solid rgba(255,255,255,0.06)",
            background: isLight ? "rgba(41,128,200,0.08)" : undefined,
          }}
        >
          Connect Wallet
        </button>
      </div>
    </div>
  );
}
