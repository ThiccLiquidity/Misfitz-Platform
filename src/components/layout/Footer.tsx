"use client";

import Link from "next/link";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Global footer. Carries the estimate/legal disclaimer (important: Traitfolio publishes VALUE ESTIMATES
// and links out to marketplaces) plus light wayfinding. Kept factual and non-advisory.
export function Footer() {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const year = new Date().getFullYear();
  const border = isLight ? "1px solid rgba(41,128,200,0.18)" : "1px solid rgba(184,146,63,0.22)";
  return (
    <footer
      className="mt-10 px-4 py-8 md:px-8"
      style={{ borderTop: border, background: isLight ? "rgba(255,255,255,0.6)" : "rgba(10,6,2,0.6)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="text-title font-bold">Traitfolio</span>
          <Link href="/browse" className="text-subtle hover:opacity-70">Browse</Link>
          <Link href="/binder" className="text-subtle hover:opacity-70">Your Binder</Link>
        </div>
        <p className="text-subtle max-w-3xl text-[12px] leading-relaxed">
          Value estimates shown on Traitfolio are generated from public market data (floor prices and
          recent sales) and rarity, are provided for informational purposes only, and are not financial
          advice or an offer to buy or sell. Actual sale prices vary. Always review the full offer on the
          source marketplace before trading — Traitfolio never holds funds and never executes trades.
        </p>
        <p className="text-subtle text-[12px] leading-relaxed">
          Traitfolio is an independent project and is not affiliated with, endorsed by, or connected to
          MintGarden, Dexie, or the Chia Network. Marketplace and blockchain data belong to their
          respective owners.
        </p>
        <p className="text-subtle text-[11px] opacity-70">© {year} Traitfolio. Built for collectors.</p>
      </div>
    </footer>
  );
}
