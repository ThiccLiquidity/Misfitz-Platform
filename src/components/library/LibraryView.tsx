"use client";

import type { CollectionData } from "@/types";
import { CollectionCoverCard, ComingSoonCard } from "./CollectionCoverCard";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Enough placeholders so the shelf always looks full regardless of how many real
// collections have been seeded. Each will be replaced with a real card as collections
// are imported. 8 total slots feels right for a first-open shelf.
const TOTAL_SHELF_SLOTS = 8;
const PREVIEW_COLLECTIONS = [
  { name: "Chia Cats",      accent: "#ff6eb4" },
  { name: "Pixel Punks",    accent: "#00d4ff" },
  { name: "Space Beans",    accent: "#5fce7a" },
  { name: "Void Walkers",   accent: "#a855f7" },
  { name: "Degen Frogs",    accent: "#f59e0b" },
  { name: "Crystal Golems", accent: "#38bdf8" },
  { name: "Lil Dragonz",    accent: "#f87171" },
];

interface LibraryViewProps {
  collections: CollectionData[];
}

export function LibraryView({ collections }: LibraryViewProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const previewCount = Math.max(0, TOTAL_SHELF_SLOTS - collections.length);
  const previews = PREVIEW_COLLECTIONS.slice(0, previewCount);

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between mb-6 pt-2">
        <div>
          {/* Light mode: gradient text via CSS class (inline background-clip: text is unreliable).
              Dark mode: solid vivid color — no clip tricks needed on dark bg. */}
          {isLight ? (
            <h1
              className="ch-title"
              style={{
                fontFamily: "var(--font-righteous), sans-serif",
                fontSize: "clamp(2rem, 4vw, 3rem)",
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
              }}
            >
              Your Binder Collection
            </h1>
          ) : (
            <h1
              className="lib-title-dark"
              style={{
                fontFamily: "var(--font-righteous), sans-serif",
                fontSize: "clamp(2.4rem, 5vw, 3.8rem)",
                lineHeight: 1.1,
                letterSpacing: "0.01em",
              }}
            >
              Your Binder Collection
            </h1>
          )}
          <p className="text-sm mt-2 font-semibold" style={{
            color: isLight ? "rgba(60,40,120,0.65)" : "rgba(180,160,255,0.65)",
          }}>
            Connect your Chia wallet to see every NFT you own across all collections.
          </p>
        </div>
        <button
          type="button"
          className="flex-shrink-0 rounded-xl px-4 py-2 text-xs font-bold border transition-all
                     hover:opacity-90 active:scale-95"
          style={isLight ? {
            background: "rgba(255,255,255,0.72)",
            borderColor: "rgba(60,120,220,0.35)",
            color: "#1144aa",
            backdropFilter: "blur(8px)",
            boxShadow: "0 2px 12px rgba(0,80,160,0.10)",
          } : {
            background: "linear-gradient(135deg, #2a2035 0%, #1a1525 100%)",
            borderColor: "rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          Connect Wallet
        </button>
      </div>

      {/* ── Bookshelf — breaks out of AppShell px padding to go edge-to-edge ── */}
      <div className="-mx-4 md:-mx-8">

        {/* Wall section behind the binders */}
        <div
          className="px-4 md:px-8 pt-8 pb-0"
          style={isLight ? {
            // Warm ivory painted wall with subtle vertical grain lines
            background: `
              repeating-linear-gradient(
                90deg,
                transparent 0px, transparent 80px,
                rgba(160,120,60,0.06) 80px, rgba(160,120,60,0.06) 81px
              ),
              linear-gradient(180deg, #f5efe6 0%, #ede5d8 100%)
            `,
            borderTop: "1px solid rgba(160,120,60,0.15)",
          } : {
            background: `
              repeating-linear-gradient(
                90deg,
                transparent 0px, transparent 60px,
                rgba(255,255,255,0.012) 60px, rgba(255,255,255,0.012) 61px
              ),
              linear-gradient(180deg, #0e0c12 0%, #100e14 100%)
            `,
          }}
        >
          {/* Binders row — fills width on desktop, scrolls horizontally on mobile */}
          <div
            className="flex gap-2 items-end overflow-x-auto pb-1"
            style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            {collections.map((c) => (
              <div key={c.slug} className="flex-1 flex-shrink-0" style={{ minWidth: "clamp(72px, 11vw, 130px)" }}>
                <CollectionCoverCard collection={c} />
              </div>
            ))}
            {previews.map((p) => (
              <div key={p.name} className="flex-1 flex-shrink-0" style={{ minWidth: "clamp(72px, 11vw, 130px)" }}>
                <ComingSoonCard collection={p} />
              </div>
            ))}
          </div>
        </div>

        {/* ── Shelf — 3-layer structure for real 3-D depth ─────────────────── */}
        {isLight ? (
          <>
            {/* Top surface — bright edge where light catches the top of the plank */}
            <div style={{
              height: 7,
              background: "linear-gradient(180deg, #e8c878 0%, #c8a050 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
            }} />
            {/* Front face — the visible face of the plank with grain texture */}
            <div style={{
              height: 52,
              background: `
                repeating-linear-gradient(
                  90deg,
                  transparent 0px, transparent 60px,
                  rgba(0,0,0,0.045) 60px, rgba(0,0,0,0.045) 62px,
                  transparent 62px, transparent 110px,
                  rgba(255,255,255,0.06) 110px, rgba(255,255,255,0.06) 111px
                ),
                linear-gradient(
                  180deg,
                  #9a7230 0%,
                  #886020 18%,
                  #7a5418 42%,
                  #6a4610 68%,
                  #5a3a0c 85%,
                  #4a2e08 100%
                )
              `,
              boxShadow:
                "inset 0 2px 4px rgba(0,0,0,0.25), " +
                "inset 0 -1px 0 rgba(0,0,0,0.4)",
            }} />
            {/* Cast shadow below the shelf */}
            <div style={{
              height: 32,
              background: "linear-gradient(180deg, rgba(80,50,10,0.30) 0%, rgba(0,0,0,0.0) 100%)",
            }} />
          </>
        ) : (
          <>
            {/* Dark mode shelf — subtle top highlight, then dark front face */}
            <div style={{
              height: 3,
              background: "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%)",
            }} />
            <div style={{
              height: 48,
              background: `
                repeating-linear-gradient(
                  90deg,
                  transparent 0px, transparent 80px,
                  rgba(0,0,0,0.18) 80px, rgba(0,0,0,0.18) 82px
                ),
                linear-gradient(
                  180deg,
                  #5a3e22 0%,
                  #6b4a28 8%,
                  #4e3319 30%,
                  #3d2812 65%,
                  #2d1d0b 85%,
                  #1e1208 100%
                )
              `,
              boxShadow:
                "inset 0 2px 4px rgba(255,255,255,0.06), " +
                "inset 0 -2px 6px rgba(0,0,0,0.6)",
            }} />
            <div style={{
              height: 28,
              background: "linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.0) 100%)",
            }} />
          </>
        )}
      </div>
    </div>
  );
}
