"use client";

import Link from "next/link";
import Image from "next/image";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Featured binder on the shelf — your whole collection (every NFT you own), opening the aggregated
// rarity-sorted binder. Visually distinct (rainbow spine + logo) so it reads as "yours".
export function YourBinderCover() {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  return (
    <Link href="/binder" className="group block" style={{ perspective: "800px" }}>
      <div
        className="relative flex overflow-hidden rounded-r-xl transition-all duration-300 group-hover:-translate-y-3"
        style={{
          aspectRatio: "2 / 3",
          boxShadow: isLight
            ? "0 8px 30px rgba(120,60,220,0.28), 0 0 0 1px rgba(0,0,0,0.06)"
            : "0 10px 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
        }}
      >
        {/* Rainbow spine */}
        <div
          className="z-[2] flex flex-shrink-0 flex-col items-center justify-evenly py-4"
          style={{ width: 18, background: "linear-gradient(180deg,#ff6ec7,#a855f7,#3b82f6,#22d3ee,#34d399)" }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 10, height: 10, borderRadius: "50%",
                background: "radial-gradient(circle at 35% 30%, #fff 0%, #999 60%, #555 100%)",
                border: "1px solid rgba(0,0,0,0.4)",
              }}
            />
          ))}
        </div>

        {/* Cover face */}
        <div
          className="flex flex-1 flex-col items-center justify-between"
          style={{ background: isLight ? "linear-gradient(160deg,#ffffff,#efe7ff)" : "linear-gradient(155deg,#2a2240,#161226)" }}
        >
          <div className="flex flex-1 items-center justify-center p-4">
            <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-auto w-3/5 drop-shadow" />
          </div>
          <div className="w-full px-3 pb-3 pt-1 text-center">
            <div
              className="text-xs font-black uppercase tracking-widest"
              style={{
                background: "linear-gradient(90deg,#a855f7,#3b82f6,#22d3ee,#34d399,#f43f5e)",
                WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
              }}
            >
              Your Binder
            </div>
            <div className="mt-0.5 text-[10px]" style={{ color: isLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.45)" }}>
              Everything you own
            </div>
            <div
              className="mt-2 text-[10px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: isLight ? "#7c3aed" : "#c4b5fd" }}
            >
              Open →
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
