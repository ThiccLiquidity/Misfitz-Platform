"use client";

import { useState } from "react";
import { computeDealScore } from "@/lib/rarity/enrich";
import { formatUsd, formatXch } from "@/lib/format";

// "What should I list this at?" coach for the OWNER of an NFT (portfolio only). Slide a price and watch the
// live badge, plus the target price for each of THREE clean tiers: Send it (below value, sells fast),
// Fair deal (around value), Raise the floor (above value). Same computeDealScore the cards use — no new
// thresholds. Link-out only: we never build or sign an offer (per CLAUDE.md); the user creates it in-wallet.

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const GREEN = "#22c55e";
const BLUE = "#3b82f6";
const AMBER = "#e8a13a";

// 3 tiers from the deal score (≥60 = below value, 40–60 = fair, <40 = above value).
function tierFor(score: number): { label: string; color: string } {
  if (score >= 60) return { label: "🚀 Send it", color: GREEN };
  if (score >= 40) return { label: "⚖️ Fair deal", color: BLUE };
  return { label: "📈 Raise the floor", color: AMBER };
}

export function ListPriceCoach({
  fairValueXch,
  xchUsdRate,
  mgNftUrl,
  isLight,
}: {
  fairValueXch: number;
  xchUsdRate: number;
  mgNftUrl: string;
  isLight: boolean;
}) {
  // Price boundaries between the three tiers (inverting computeDealScore's 60/40 score cutoffs).
  const sendTop = round(fairValueXch * (1 - 10 / 120)); // <= this -> Send it (≈0.917×)
  const fairTop = round(fairValueXch * (1 + 10 / 120)); // <= this -> Fair deal (≈1.083×); above -> Raise the floor

  const min = Math.max(0.01, round(fairValueXch * 0.5));
  const max = Math.max(min + 0.01, round(fairValueXch * 1.6)); // guard: max>min so the slider never /0
  const step = Math.max(0.01, round(fairValueXch / 200));

  const [price, setPrice] = useState<number>(round(fairValueXch));
  const t = tierFor(computeDealScore(fairValueXch, price).score);
  const pct = max > min ? Math.max(0, Math.min(100, ((price - min) / (max - min)) * 100)) : 100;

  const row = (label: string, text: string, color: string) => (
    <div className="flex items-center justify-between rounded-md px-2 py-1 text-[11px]"
      style={{ background: `${color}1f`, color }}>
      <span className="font-bold">{label}</span>
      <span className="font-semibold tabular-nums">{text}</span>
    </div>
  );

  return (
    <div className="mt-3 rounded-xl p-3"
      style={{ background: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)", border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}` }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: isLight ? "#0a1e38" : "#f0d9a0" }}>
          Thinking of listing?
        </span>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-black text-white" style={{ background: t.color }}>{t.label}</span>
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-2xl font-black tabular-nums" style={{ color: t.color }}>{formatXch(price)} XCH</span>
        <span className="text-xs font-semibold" style={{ color: isLight ? "#6a4d0e" : "#d9c896" }}>
          ≈ {formatUsd(round(price * xchUsdRate))}
        </span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={price}
        onChange={(e) => setPrice(Number(e.target.value))}
        aria-label="List price"
        className="w-full cursor-pointer"
        style={{ accentColor: t.color, background: `linear-gradient(90deg, ${t.color} ${pct}%, ${isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)"} ${pct}%)` }}
      />

      <div className="mt-2 grid grid-cols-1 gap-1">
        {row("🚀 Send it", `list ≤ ${formatXch(sendTop)} XCH`, GREEN)}
        {row("⚖️ Fair deal", `${formatXch(sendTop)}–${formatXch(fairTop)} XCH`, BLUE)}
        {row("📈 Raise the floor", `above ${formatXch(fairTop)} XCH`, AMBER)}
      </div>

      <a href={mgNftUrl} target="_blank" rel="noopener noreferrer"
        className="mt-2.5 block rounded-lg px-3 py-2 text-center text-[13px] font-bold text-white transition hover:brightness-110"
        style={{ background: t.color }}>
        List it — create the offer in your wallet ↗
      </a>
      <p className="mt-1 text-center text-[10px]" style={{ color: isLight ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.45)" }}>
        We never touch your NFT. Create + sign the offer in your wallet, then post it on a marketplace.
      </p>
    </div>
  );
}
