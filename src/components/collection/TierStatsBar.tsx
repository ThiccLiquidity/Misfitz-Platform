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

// Nostalgia (Retro) day: each cell is a saturated tint of its CANONICAL rarity accent (same hue the
// NFT cards use — common reads BLUE, uncommon GREEN, rare RED, epic light-blue, legendary GOLD, mythic
// PURPLE), a solid accent cap, deep-accent ink, and a real glow (built from `accent`).
const TIER_NOST: Record<string, { bg: string; ink: string; cap: string; accent: string }> = {
  mythic:    { bg: "linear-gradient(180deg,#ebc6ff 0%,#d9a0ff 100%)", ink: "#6a1a99", cap: "#cc66ff", accent: "#cc66ff" },
  legendary: { bg: "linear-gradient(180deg,#ffe9a3 0%,#f7d15e 100%)", ink: "#8a6000", cap: "#f0c000", accent: "#f0c000" },
  epic:      { bg: "linear-gradient(180deg,#d6ebff 0%,#a8d0ff 100%)", ink: "#1a5aa0", cap: "#5f9fe6", accent: "#a8d0ff" },
  rare:      { bg: "linear-gradient(180deg,#ffc9c1 0%,#ff9a8e 100%)", ink: "#a3241a", cap: "#ff6060", accent: "#ff6060" },
  uncommon:  { bg: "linear-gradient(180deg,#c9f0c2 0%,#9fe0a3 100%)", ink: "#1f7a34", cap: "#5fce7a", accent: "#5fce7a" },
  common:    { bg: "linear-gradient(180deg,#c6dbfb 0%,#9dbdf3 100%)", ink: "#1c4fa0", cap: "#6090e0", accent: "#6090e0" },
};
// Nostalgia night: near-dark cell with a strong neon glow in the accent — saturated accent cap and
// glowing accent numerals (same energy as the Dark branch, hue-matched to the cards).
const TIER_NOST_NIGHT: Record<string, { bg: string; ink: string; cap: string; accent: string }> = {
  mythic:    { bg: "linear-gradient(180deg,#2a1140 0%,#180a28 100%)", ink: "#e6b3ff", cap: "#cc66ff", accent: "#cc66ff" },
  legendary: { bg: "linear-gradient(180deg,#2a2008 0%,#181204 100%)", ink: "#ffe08a", cap: "#f0c000", accent: "#f0c000" },
  epic:      { bg: "linear-gradient(180deg,#0e2447 0%,#08162e 100%)", ink: "#bfdfff", cap: "#a8d0ff", accent: "#a8d0ff" },
  rare:      { bg: "linear-gradient(180deg,#2e0f0c 0%,#1a0806 100%)", ink: "#ff9e94", cap: "#ff6060", accent: "#ff6060" },
  uncommon:  { bg: "linear-gradient(180deg,#0e2a16 0%,#08190d 100%)", ink: "#8fe6a3", cap: "#5fce7a", accent: "#5fce7a" },
  common:    { bg: "linear-gradient(180deg,#0e1e44 0%,#08122c 100%)", ink: "#a8c4ff", cap: "#6090e0", accent: "#6090e0" },
};

interface TierStatsBarProps {
  collection: CollectionData;
  nfts: NftData[];
}

export function TierStatsBar({ collection, nfts }: TierStatsBarProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const isNostalgia = mode === "nostalgia" || mode === "nostalgia-night";
  const nostNight = mode === "nostalgia-night";

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

  // Many Chia collections aren't OpenRarity-ranked on MintGarden yet (openrarity_rank: null). Those
  // NFTs can't be tiered, so rather than silently showing zeros we surface the count explicitly.
  const unrankedCount = useMemo(() => nfts.filter((n) => !n.rarityRank).length, [nfts]);
  const rankedCount = nfts.length - unrankedCount;

  return (
    <div
      className="tf-tierbar rounded-2xl mb-4 overflow-hidden"
      style={{
        background: isLight ? "rgba(255,255,255,0.72)" : "rgba(21,15,9,0.88)",
        border: isLight ? "1px solid rgba(100,180,255,0.35)" : "1px solid rgba(201,162,39,0.18)",
        boxShadow: isLight
          ? "0 6px 28px rgba(0,80,160,0.14), inset 0 1px 0 rgba(255,255,255,0.9)"
          : "0 6px 28px rgba(0,0,0,0.5)",
        backdropFilter: isLight ? "blur(12px)" : undefined,
      }}
    >
      {/* Mobile: 3x2 grid so long tier labels have room; desktop: single flex row */}
      <div className="grid grid-cols-3 md:flex md:items-stretch">
        {TIER_ORDER.map((id, i) => {
          const v     = getTierVisual(id);
          const count = tierCounts[id] ?? 0;
          const tierPct = ((thresholds[id] - (i > 0 ? thresholds[TIER_ORDER[i - 1]] : 0))).toFixed(2);
          const divider = i < TIER_ORDER.length - 1
            ? isLight ? "1px solid rgba(100,150,255,0.12)" : "1px solid rgba(255,255,255,0.06)"
            : "none";

          if (isNostalgia) {
            const nv = (nostNight ? TIER_NOST_NIGHT : TIER_NOST)[id];
            const acc = nv.accent;
            const nostDivider = i < TIER_ORDER.length - 1
              ? nostNight ? "1.5px solid rgba(111,131,171,0.35)" : "1.5px solid rgba(154,100,40,0.35)"
              : "none";
            // Real rarity glow, built from the canonical accent: inner accent wash + outer accent halo.
            // DAY: rare-and-up get a stronger cool glow (mirrors how the NFT cards make elites pop);
            // common + uncommon stay calm so the elite tiers clearly stand out on the warm manila.
            const elite = id === "mythic" || id === "legendary" || id === "epic" || id === "rare";
            // DAY elites (rare+) get a radioactive bloom rendered INSIDE the cell (the bar clips outer glow,
            // so it must live within the cell). NIGHT is left exactly as it was — only the day bar needed glow.
            const bgFinal = (!nostNight && elite)
              ? `radial-gradient(circle at 50% 45%, ${acc}aa 0%, ${acc}44 38%, rgba(0,0,0,0) 70%), ${nv.bg}`
              : nv.bg;
            const cellGlow = nostNight
              ? `inset 0 1px 0 rgba(170,198,255,0.18), inset 0 0 40px ${acc}33, inset 0 -10px 18px rgba(0,0,0,0.30), 0 0 16px ${acc}55`
              : elite
                ? `inset 0 2px 0 rgba(255,255,255,0.6), inset 0 0 50px ${acc}77, inset 0 -10px 18px rgba(93,58,26,0.10)`
                : `inset 0 2px 0 rgba(255,255,255,0.6), inset 0 0 16px ${acc}22, inset 0 -10px 18px rgba(93,58,26,0.10)`;
            const numGlow = nostNight
              ? `0 1px 0 rgba(0,0,0,0.45), 0 0 12px ${acc}, 0 0 22px ${acc}99`
              : elite
                ? `0 1px 0 rgba(255,255,255,0.8), 0 0 16px ${acc}, 0 0 30px ${acc}dd, 0 3px 5px rgba(93,58,26,0.25)`
                : `0 1px 0 rgba(255,255,255,0.7), 0 3px 5px rgba(93,58,26,0.25)`;
            return (
              <div key={id} className={`tf-tiercell tf-tiercell-${id} min-w-0 flex-1 relative flex flex-col items-center justify-center py-2.5 md:py-5 gap-0.5 md:gap-1`}
                style={{ background: bgFinal, borderRight: nostDivider, boxShadow: cellGlow }}>
                {/* Thick solid tier cap — the "sticker" top edge, glowing in the accent */}
                <div style={{ position:"absolute", top:0, left:0, right:0, height:6, background: nv.cap, boxShadow:`0 0 10px ${acc}aa, 0 1px 3px rgba(0,0,0,0.25)` }} />
                <span style={{ fontSize:"clamp(20px,5.4vw,26px)", lineHeight:1, marginBottom:2, filter: nostNight ? `drop-shadow(0 0 6px ${acc}aa)` : "drop-shadow(0 1px 1px rgba(0,0,0,0.25))" }}>{v.emoji}</span>
                <span style={{ color: nv.ink, fontWeight:900, fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase" as const, lineHeight:1, textShadow: nostNight ? `0 0 8px ${acc}66` : "0 1px 0 rgba(255,255,255,0.5)" }}>{v.label}</span>
                <span style={{ color: nv.ink, fontWeight:900, fontSize:"clamp(26px,8vw,42px)", lineHeight:1, letterSpacing:"-0.02em", marginTop:2, marginBottom:2, textShadow: numGlow }}>{count.toLocaleString()}</span>
                <span style={{ color: nv.ink, fontWeight:800, fontSize:11, opacity:0.82, lineHeight:1 }}>{tierPct}%</span>
              </div>
            );
          }

          if (isLight) {
            const lv = TIER_LIGHT[id];
            return (
              <div key={id} className={`tf-tiercell tf-tiercell-${id} min-w-0 flex-1 relative flex flex-col items-center justify-center py-2.5 md:py-5 gap-0.5 md:gap-1`}
                style={{ background: lv.bg, borderRight: divider }}>
                {/* Top accent bar */}
                <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background: lv.topBorder, borderRadius:"2px 2px 0 0" }} />
                {/* Emoji */}
                <span style={{ fontSize:"clamp(16px,4.6vw,22px)", lineHeight:1, marginBottom:2 }}>{v.emoji}</span>
                {/* Label — solid color in light mode (gradient bars at 11px bold) */}
                <span style={{ color: lv.countColor, fontWeight:900, fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase", lineHeight:1, opacity:0.85 }}>
                  {v.label}
                </span>
                {/* Count — solid bold color + glow shadow */}
                <span style={{ color: lv.countColor, fontWeight:900, fontSize:"clamp(23px,7.4vw,36px)", lineHeight:1, letterSpacing:"-0.02em", textShadow: lv.countShadow, marginTop:2, marginBottom:2 }}>
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
            <div key={id} className={`tf-tiercell tf-tiercell-${id} min-w-0 flex-1 relative flex flex-col items-center justify-center py-2.5 md:py-5 gap-0.5 md:gap-1`}
              style={{ background: dv.bg, borderRight: divider, boxShadow: `inset 0 0 40px ${dv.glow}22` }}>
              <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background: dv.topBorder, borderRadius:"2px 2px 0 0" }} />
              <span style={{ fontSize:"clamp(16px,4.6vw,22px)", lineHeight:1, marginBottom:2 }}>{v.emoji}</span>
              <span style={{ ...gradStyle, fontWeight:900, fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase" as const, lineHeight:1 }}>{v.label}</span>
              <span style={{ ...gradStyle, fontWeight:900, fontSize:"clamp(23px,7.4vw,36px)", lineHeight:1, letterSpacing:"-0.02em", marginTop:2, marginBottom:2 }}>{count.toLocaleString()}</span>
              <span style={{ ...gradStyle, fontWeight:700, fontSize:11, opacity:0.65, lineHeight:1 }}>{tierPct}%</span>
            </div>
          );
        })}
      </div>

      {unrankedCount > 0 && (
        <div
          className="flex items-center justify-center gap-1.5 px-4 py-2 text-[11px]"
          style={{
            borderTop: isLight ? "1px solid rgba(100,150,255,0.14)" : "1px solid rgba(255,255,255,0.06)",
            background: isLight ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.25)",
            color: isLight ? "#5a6a85" : "rgba(255,255,255,0.5)",
          }}
        >
          <span style={{ fontWeight: 700 }}>{rankedCount.toLocaleString()}</span>
          <span>ranked</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span style={{ fontWeight: 700 }}>{unrankedCount.toLocaleString()}</span>
          <span>not yet scored by the rarity index</span>
        </div>
      )}
    </div>
  );
}
