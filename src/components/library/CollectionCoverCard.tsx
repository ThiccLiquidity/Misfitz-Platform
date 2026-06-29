"use client";

import Link from "next/link";
import type { CollectionData } from "@/types";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// ── Live card ─────────────────────────────────────────────────────────────────

interface CollectionCoverCardProps {
  collection: CollectionData;
}

export function CollectionCoverCard({ collection }: CollectionCoverCardProps) {
  const accent = collection.theme?.accent ?? "#888888";
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const shadowIdle = isLight
    ? `0 6px 24px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06), 0 0 40px ${accent}00`
    : `0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), 0 0 40px ${accent}00`;

  const shadowHover = isLight
    ? `0 16px 48px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08), 0 8px 32px ${accent}44`
    : `0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.07), 0 8px 40px ${accent}55`;

  const coverBg = isLight
    ? `repeating-linear-gradient(
        -52deg,
        transparent 0px, transparent 4px,
        rgba(0,0,0,0.025) 4px, rgba(0,0,0,0.025) 5px
      ),
      linear-gradient(160deg, #ffffff 0%, ${accent}40 55%, ${accent}28 100%)`
    : `repeating-linear-gradient(
        -52deg,
        transparent 0px, transparent 3px,
        rgba(0,0,0,0.05) 3px, rgba(0,0,0,0.05) 4px
      ),
      linear-gradient(155deg, #1e1c28 0%, #14121a 55%, #0c0a10 100%)`;

  const fadeGradient = isLight
    ? `linear-gradient(to bottom, transparent 0%, ${accent}22 60%, ${accent}44 100%)`
    : "linear-gradient(to bottom, transparent 0%, rgba(12,10,16,0.95) 100%)";

  const nftCountColor = isLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.4)";

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="group block"
      style={{ perspective: "800px" }}
    >
      <div
        className="relative flex rounded-r-xl overflow-hidden transition-all duration-300
                   group-hover:-translate-y-3"
        style={{
          aspectRatio: "2 / 3",
          boxShadow: shadowIdle,
          transition: "transform 0.3s ease, box-shadow 0.3s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = shadowHover;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = shadowIdle;
        }}
      >
        {/* Spine ───────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex flex-col items-center justify-evenly py-4 z-[2]"
          style={{
            width: 18,
            background: `linear-gradient(180deg, ${accent}ee 0%, ${accent}99 100%)`,
            boxShadow: isLight
              ? `inset -3px 0 10px rgba(0,0,0,0.25), 2px 0 6px rgba(0,0,0,0.15)`
              : `inset -3px 0 10px rgba(0,0,0,0.5), 2px 0 8px rgba(0,0,0,0.4)`,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: isLight
                  ? "radial-gradient(circle at 35% 30%, #e8e8ec 0%, #9090a0 55%, #606068 100%)"
                  : "radial-gradient(circle at 35% 30%, #b0b0b8 0%, #454550 55%, #18181e 100%)",
                border: isLight ? "1px solid rgba(0,0,0,0.2)" : "1px solid rgba(0,0,0,0.6)",
                boxShadow: isLight
                  ? "0 2px 4px rgba(0,0,0,0.25), inset 0 1px 2px rgba(255,255,255,0.5)"
                  : "0 2px 5px rgba(0,0,0,0.8), inset 0 1px 2px rgba(255,255,255,0.2)",
              }}
            />
          ))}
        </div>

        {/* Cover face ──────────────────────────────────────── */}
        <div
          className="flex-1 flex flex-col"
          style={{ background: coverBg }}
        >
          {/* Cover art */}
          <div className="flex-1 relative overflow-hidden">
            {collection.bannerUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={collection.bannerUrl}
                alt={collection.name}
                className="w-full h-full object-cover object-top opacity-80
                           group-hover:opacity-95 transition-opacity duration-300"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{
                  background: `radial-gradient(ellipse at 50% 40%, ${accent}22 0%, transparent 70%)`,
                }}
              >
                <div
                  className="rounded-full opacity-30"
                  style={{
                    width: 64,
                    height: 64,
                    background: `radial-gradient(circle, ${accent} 0%, transparent 70%)`,
                  }}
                />
              </div>
            )}

            {/* Gradient fade into bottom info area */}
            <div
              className="absolute inset-x-0 bottom-0 h-16"
              style={{ background: fadeGradient }}
            />
          </div>

          {/* Info strip */}
          <div className="px-3 pb-3 pt-1 flex-shrink-0">
            <div
              className="text-xs font-black uppercase tracking-widest leading-tight truncate"
              style={{ color: accent }}
            >
              {collection.name}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: nftCountColor }}>
              {collection.nftCount.toLocaleString()} NFTs
            </div>

            {/* CTA — fades in on hover */}
            <div
              className="text-[10px] font-semibold mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{ color: `${accent}cc` }}
            >
              Open Binder →
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Coming-soon placeholder ───────────────────────────────────────────────────

interface PreviewCollection {
  name: string;
  accent: string;
}

export function ComingSoonCard({ collection }: { collection: PreviewCollection }) {
  const { accent, name } = collection;
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const coverBg = isLight
    ? `repeating-linear-gradient(
        -52deg,
        transparent 0px, transparent 4px,
        rgba(0,0,0,0.025) 4px, rgba(0,0,0,0.025) 5px
      ),
      linear-gradient(160deg, #ffffff 0%, ${accent}38 55%, ${accent}22 100%)`
    : `repeating-linear-gradient(
        -52deg,
        transparent 0px, transparent 3px,
        rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px
      ),
      linear-gradient(155deg, #1c1a24 0%, #131118 55%, #0c0a10 100%)`;

  const cardShadow = isLight
    ? `0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)`
    : `0 6px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)`;

  const lockBg = isLight ? `rgba(0,0,0,0.04)` : `rgba(255,255,255,0.04)`;
  const lockBorder = isLight ? `1px solid ${accent}44` : `1px solid ${accent}33`;
  const lockStroke = isLight ? `${accent}99` : `${accent}88`;
  const comingSoonColor = isLight ? "rgba(0,0,0,0.38)" : "rgba(255,255,255,0.3)";
  const nameColor = isLight ? `${accent}cc` : `${accent}99`;

  return (
    <div className="block cursor-default">
      <div
        className="relative flex rounded-r-xl overflow-hidden"
        style={{
          aspectRatio: "2 / 3",
          boxShadow: cardShadow,
        }}
      >
        {/* Spine */}
        <div
          className="flex-shrink-0 flex flex-col items-center justify-evenly py-4"
          style={{
            width: 18,
            background: `linear-gradient(180deg, ${accent}88 0%, ${accent}44 100%)`,
            boxShadow: isLight
              ? `inset -2px 0 6px rgba(0,0,0,0.15)`
              : `inset -2px 0 6px rgba(0,0,0,0.4)`,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: isLight
                  ? "radial-gradient(circle at 35% 30%, #ddd 0%, #999 60%, #666 100%)"
                  : "radial-gradient(circle at 35% 30%, #666 0%, #2a2a2a 60%, #0d0d0d 100%)",
                border: isLight ? "1px solid rgba(0,0,0,0.15)" : "1px solid rgba(0,0,0,0.5)",
                boxShadow: isLight
                  ? "inset 0 1px 2px rgba(255,255,255,0.6)"
                  : "inset 0 1px 2px rgba(255,255,255,0.08)",
              }}
            />
          ))}
        </div>

        {/* Cover */}
        <div
          className="flex-1 flex flex-col"
          style={{ background: coverBg }}
        >
          {/* Art placeholder with accent glow */}
          <div
            className="flex-1 flex flex-col items-center justify-center gap-3"
            style={{
              background: `radial-gradient(ellipse at 50% 40%, ${accent}14 0%, transparent 65%)`,
            }}
          >
            {/* Lock */}
            <div
              className="rounded-full p-3"
              style={{ background: lockBg, border: lockBorder }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={lockStroke}
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          </div>

          <div className="px-3 pb-3 pt-1 flex-shrink-0">
            <div
              className="text-xs font-black uppercase tracking-widest truncate"
              style={{ color: nameColor }}
            >
              {name}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: comingSoonColor }}>
              Coming soon
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
