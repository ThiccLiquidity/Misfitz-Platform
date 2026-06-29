"use client";

import { useMemo } from "react";
import { TIER_ORDER, getTierVisual, resolveTierThresholds } from "@/lib/rarity/tiers";
import type { CollectionData, NftData } from "@/types";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// Dark-mode: vivid gradients on near-black cell backgrounds
const TIER_DARK: Record<string, {
  bg:           string;
  topBorder:    string;
  textGradient: string;  // used for label, count, pct
  glow:         string;
}> = {
  mythic:    { bg: "linear-gradient(180deg, #220040 0%, #120020 100%)", topBorder: "linear-gradient(90deg, #ff60cc, #cc88ff, #60ccff, #88ff88, #ffee44, #ff9944)", textGradient: "linear-gradient(90deg, #ff80dd, #dd99ff, #80ddff, #aaff99, #ffee66, #ffaa55)", glow: "rgba(200,80,255,0.45)" },
  legendary: { bg: "linear-gradient(180deg, #1f1400 0%, #100a00 100%)", topBorder: "linear-gradient(90deg, #c89000, #f0c000, #ffe577, #f0c000, #c89000)", textGradient: "linear-gradient(90deg, #c89000, #f0c000, #ffe577, #f0c000, #c89000)", glow: "rgba(240,180,0,0.4)" },
  epic:      { bg: "linear-gradient(180deg, #000e3a 0%, #000820 100%)", topBorder: "linear-gradient(90deg, #3377cc, #88bbff, #c0ddff, #88bbff, #3377cc)", textGradient: "linear-gradient(90deg, #5599ee, #99ccff, #c0e0ff, #99ccff, #5599ee)", glow: "rgba(100,170,255,0.4)" },
  rare:      { bg: "linear-gradient(180deg, #1e0000 0%, #0e0000 100%)", topBorder: "linear-gradient(90deg, #cc1111, #ff6060, #ff9944, #ff6060, #cc1111)", textGradient: "linear-gradient(90deg, #cc2222, #ff6666, #ff9955, #ff6666, #cc2222)", glow: "rgba(255,80,80,0.4)" },
  uncommon:  { bg: "linear-gradient(180deg, #001e06 0%, #001006 100%)", topBorder: "linear-gradient(90deg, #1a8035, #5fce7a, #aaee99, #5fce7a, #1a8035)", textGradient: "linear-gradient(90deg, #1a8035, #5fce7a, #aaee99, #5fce7a, #1a8035)", glow: "rgba(80,200,110,0.4)" },
  common:    { bg: "linear-gradient(180deg, #00071e 0%, #000412 100%)", topBorder: "linear-gradient(90deg, #2244aa, #6090e0, #99bbff, #6090e0, #2244aa)", textGradient: "linear-gradient(90deg, #2244aa, #6090e0, #99bbff, #6090e0, #2244aa)", glow: "rgba(100,150,240,0.35)" },
};

// Light-mode: frosted white with soft tier tint. Count is solid + glow (not gradient —
// gradient on big bold numerals makes each digit look like a separate colored block).
const TIER_LIGHT: Record<string, {
  bg:           string;
  topBorder:    string;
  labelGradient: string;  // small label text — gradient is fine at 11px
  countColor:   string;   // solid color for the big hero number
  countShadow:  string;   // glow text-shadow for the hero number
  pctColor:     string;
}> = {
  mythic:    {
    bg:            "linear-gradient(180deg, rgba(180,60,255,0.09) 0%, rgba(140,40,220,0.04) 100%)",
    topBorder:     "linear-gradient(90deg, #ff60cc, #cc88ff, #60ccff, #88ff88, #ffee44, #ff9944)",
    labelGradient: "linear-gradient(90deg, #aa00cc, #7700bb, #0066bb)",
    countColor:    "#7700bb",
    countShadow:   "0 0 14px rgba(180,60,255,0.45), 0 1px 3px rgba(0,0,0,0.15)",
    pctColor:      "#9900cc",
  },
  legendary: {
    bg:            "linear-gradient(180deg, rgba(220,160,0,0.11) 0%, rgba(180,120,0,0.04) 100%)",
    topBorder:     "linear-gradient(90deg, #c89000, #f0c000, #ffe577, #f0c000, #c89000)",
    labelGradient: "linear-gradient(90deg, #7a5500, #a07000, #c89000)",
    countColor:    "#8a6000",
    countShadow:   "0 0 14px rgba(220,160,0,0.45), 0 1px 3px rgba(0,0,0,0.15)",
    pctColor:      "#9a6800",
  },
  epic:      {
    bg:            "linear-gradient(180deg, rgba(60,120,240,0.09) 0%, rgba(40,90,200,0.04) 100%)",
    topBorder:     "linear-gradient(90deg, #3377cc, #88bbff, #c0ddff, #88bbff, #3377cc)",
    labelGradient: "linear-gradient(90deg, #1144cc, #2266ee, #1155dd)",
    countColor:    "#1144cc",
    countShadow:   "0 0 14px rgba(60,120,240,0.45), 0 1px 3px rgba(0,0,0,0.15)",
    pctColor:      "#1155cc",
  },
  rare:      {
    bg:            "linear-gradient(180deg, rgba(220,40,40,0.09) 0%, rgba(180,20,20,0.04) 100%)",
    topBorder:     "linear-gradient(90deg, #cc1111, #ff6060, #ff9944, #ff6060, #cc1111)",
    labelGradient: "linear-gradient(90deg, #aa1111, #cc2222, #aa1111)",
    countColor:    "#bb1111",
    countShadow:   "0 0 14px rgba(220,40,40,0.45), 0 1px 3px rgba(0,0,0,0.15)",
    pctColor:      "#aa1111",
  },
  uncommon:  {
    bg:            "linear-gradient(180deg, rgba(40,180,80,0.09) 0%, rgba(20,140,50,0.04) 100%)",
    topBorder:     "linear-gradient(90deg, #1a8035, #5fce7a, #aaee99, #5fce7a, #1a8035)",
    labelGradient: "linear-gradient(90deg, #116622, #1a8035, #116622)",
    countColor:    "#116622",
    countShadow:   "0 0 14px rgba(40,180,80,0.45), 0 1px 3px rgba(0,0,0,0.15)",
    pctColor:      "#1a7a2e",
  },
  common:    {
    bg:            "linear-gradient(180deg, rgba(50,110,210,0.09) 0%, rgba(30,80,170,0.04) 100%)",
    topBorder:     "linear-gradient(90deg, #2244aa, #6090e0, #99bbff, #6090e0, #2244aa)",
    labelGradient: "linear-gradient(90deg, #1133cc, #2244bb, #1133cc)",
    countColor:    "#1133bb",
    countShadow:   "0 0 14px rgba(50,110,210,0.45), 0 1px 3px rgba(0,0,0,0.15)",
    pctColor:      "#1144cc",
  },
};

interface TierStatsBarProps {
  collection: CollectionData;
  nfts: NftData[];
}

export function TierStatsBar({ collection, nfts }: TierStatsBarProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  const thresholds = useMemo(
    () => resolveTierThresholds(collection.rarityTiers),
    [collection.rarityTiers],
  );

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of TIER_ORDER) counts[id] = 0;
    for (const nft of nfts) {
      if (!nft.rarityRank) continue;
      const pct = (nft.rarityRank / (nft.totalSupply ?? collection.totalSupply)) * 100;
      let assigned = false;
      let prev = 0;
      for (const id of TIER_ORDER) {
        const max = thresholds[id];
        if (pct > prev && pct <= max) { counts[id]++; assigned = true; break; }
        prev = max;
      }
      if (!assigned) counts["common"]++;
    }
    return counts;
  }, [nfts, thresholds, collection.totalSupply]);  // per-nft totalSupply respected for mixed binders

  return (
    <div
      className="rounded-2xl mb-4 overflow-hidden"
      style={{
        background: isLight ? "rgba(255,255,255,0.72)" : "rgba(12,12,18,0.85)",
        border: isLight ? "1px solid rgba(100,180,255,0.35)" : "1px solid rgba(255,255,255,0.07)",
        boxShadow: isLight
          ? "0 6px 28px rgba(0,80,160,0.14), inset 0 1px 0 rgba(255,255,255,0.9)"
          : "0 6px 28px rgba(0,0,0,0.5)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-stretch overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {TIER_ORDER.map((id, i) => {
          const v     = getTierVisual(id);
          const count = tierCounts[id] ?? 0;
          const tierPct = ((thresholds[id] - (i > 0 ? thresholds[TIER_ORDER[i - 1]] : 0))).toFixed(2);
          const divider = i < TIER_ORDER.length - 1
            ? isLight ? "1px solid rgba(100,150,255,0.12)" : "1px solid rgba(255,255,255,0.06)"
            : "none";

          if (isLight) {
            const lv = TIER_LIGHT[id];
            return (
              <div key={id} className="flex-1 relative flex flex-col items-center justify-center py-5 gap-1"
                style={{ background: lv.bg, borderRight: divider, minWidth: 80 }}>
                {/* Top accent bar */}
                <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background: lv.topBorder, borderRadius:"2px 2px 0 0" }} />
                {/* Emoji */}
                <span style={{ fontSize:22, lineHeight:1, marginBottom:2 }}>{v.emoji}</span>
                {/* Label — solid color in light mode (gradient bars at 11px bold) */}
                <span style={{ color: lv.countColor, fontWeight:900, fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase", lineHeight:1, opacity:0.85 }}>
                  {v.label}
                </span>
                {/* Count — solid bold color + glow shadow */}
                <span style={{ color: lv.countColor, fontWeight:900, fontSize:36, lineHeight:1, letterSpacing:"-0.02em", textShadow: lv.countShadow, marginTop:2, marginBottom:2 }}>
                  {count.toLocaleString()}
                </span>
                {/* Band pct */}
                <span style={{ color: lv.pctColor, fontWeight:700, fontSize:11, opacity:0.65, lineHeight:1 }}>
                  {tierPct}%
                </span>
              </div>
            );
          }

          // Dark mode — full gradient text
          const dv = TIER_DARK[id];
          const gradStyle = { background: dv.textGradient, WebkitBackgroundClip:"text" as const, backgroundClip:"text" as const, WebkitTextFillColor:"transparent", color:"transparent" };
          return (
            <div key={id} className="flex-1 relative flex flex-col items-center justify-center py-5 gap-1"
              style={{ background: dv.bg, borderRight: divider, boxShadow: `inset 0 0 40px ${dv.glow}22`, minWidth: 80 }}>
              <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background: dv.topBorder, borderRadius:"2px 2px 0 0" }} />
              <span style={{ fontSize:22, lineHeight:1, marginBottom:2 }}>{v.emoji}</span>
              <span style={{ ...gradStyle, fontWeight:900, fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase" as const, lineHeight:1 }}>{v.label}</span>
              <span style={{ ...gradStyle, fontWeight:900, fontSize:36, lineHeight:1, letterSpacing:"-0.02em", marginTop:2, marginBottom:2 }}>{count.toLocaleString()}</span>
              <span style={{ ...gradStyle, fontWeight:700, fontSize:11, opacity:0.65, lineHeight:1 }}>{tierPct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
