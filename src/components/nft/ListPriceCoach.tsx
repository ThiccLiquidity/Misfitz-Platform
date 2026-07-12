"use client";

import { useState } from "react";
import { computeDealScore } from "@/lib/rarity/enrich";
import { colorForLabel, funLabel, scoreColor } from "./DealScoreGauge";
import { formatUsd, formatXch } from "@/lib/format";

// "What should I list this at?" coach for the OWNER of an NFT (portfolio only). Slide a price and watch the
// live badge our shoppers will see (Send it / Cop it / Fair play / Raise the floor), plus the target price
// for each badge. Pure client math on top of the same computeDealScore the cards use — no new thresholds.
// Link-out only: we never build or sign an offer (per CLAUDE.md); the user creates it in their wallet.

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
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
  // Invert computeDealScore (score = 50 + (1 - price/fair)*120): the list-price boundaries per badge.
  const sendIt = round(fairValueXch * 0.75);      // <= this  -> GREAT ("Send it")   — sells fastest
  const copIt = round(fairValueXch * (1 - 10 / 120)); // <= 0.9167x -> GOOD ("Cop it")
  const fairTop = round(fairValueXch * (1 + 10 / 120)); // <= 1.0833x -> FAIR ("Fair play"); above -> premium

  const min = Math.max(0.01, round(fairValueXch * 0.5));
  const max = Math.max(min + 0.01, round(fairValueXch * 1.6)); // guard: max>min so the slider never divides by zero
  const step = Math.max(0.01, round(fairValueXch / 200));

  const [price, setPrice] = useState<number>(round(fairValueXch));
  const ds = computeDealScore(fairValueXch, price);
  const color = scoreColor(ds.score);
  const label = funLabel(ds.label);
  const pct = max > min ? Math.max(0, Math.min(100, ((price - min) / (max - min)) * 100)) : 100;

  const chip = (mark: string, text: string, lbl: string) => (
    <div className="flex items-center justify-between rounded-md px-2 py-1 text-[11px]"
      style={{ background: `${colorForLabel(lbl)}1f`, color: colorForLabel(lbl) }}>
      <span className="font-bold">{mark} {funLabel(lbl)}</span>
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
        <span className="rounded-full px-2 py-0.5 text-[11px] font-black text-white" style={{ background: color }}>{label}</span>
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-2xl font-black tabular-nums" style={{ color }}>{formatXch(price)} XCH</span>
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
        style={{ accentColor: color, background: `linear-gradient(90deg, ${color} ${pct}%, ${isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)"} ${pct}%)` }}
      />

      <div className="mt-2 grid grid-cols-1 gap-1">
        {chip("🚀", `list ≤ ${formatXch(sendIt)} XCH`, "GREAT DEAL")}
        {chip("🤝", `≤ ${formatXch(copIt)} XCH`, "GOOD DEAL")}
        {chip("⚖️", `${formatXch(copIt)}–${formatXch(fairTop)} XCH`, "FAIR DEAL")}
        {chip("📈", `above ${formatXch(fairTop)} XCH`, "OVERPRICED")}
      </div>

      <a href={mgNftUrl} target="_blank" rel="noopener noreferrer"
        className="mt-2.5 block rounded-lg px-3 py-2 text-center text-[13px] font-bold text-white transition hover:brightness-110"
        style={{ background: color }}>
        List it — create the offer in your wallet ↗
      </a>
      <p className="mt-1 text-center text-[10px]" style={{ color: isLight ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.45)" }}>
        We never touch your NFT. Create + sign the offer in your wallet, then post it on a marketplace.
      </p>
    </div>
  );
}
