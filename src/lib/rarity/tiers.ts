// Pokemon/TCG-style rarity tiers. Percentile-based (rarityRank / totalSupply * 100), never a
// fixed rank cutoff, so the exact same code works for a 500-NFT collection, a 10,000-NFT one,
// or anything in between/beyond — no rewrite when a new collection joins the platform.
//
// Two layers, deliberately separated:
//  1. THRESHOLDS (what % of the collection falls in each tier) — collection-configurable. A
//     collection plugin can set its own via `rarityTiers` (see CollectionPlugin); anything it
//     doesn't override falls back to DEFAULT_RARITY_TIERS below.
//  2. VISUALS (what each tier looks like — label, emoji, accent color, effects) — fixed platform
//     design language, NOT collection-configurable. A Legendary looks like a Legendary on every
//     collection, the same way a holo rare looks the same across different physical TCG sets.
//
// CSS class names are derived from tier.id in the component (e.g. tcg-outer-mythic, tcg-panel-epic).
// All visual chrome lives in globals.css; tiers.ts only carries data.

export type TierId = "mythic" | "legendary" | "epic" | "rare" | "uncommon" | "common";

export const TIER_ORDER: TierId[] = ["mythic", "legendary", "epic", "rare", "uncommon", "common"];

// Percent values (0-100). Each is the upper bound (inclusive) of "top X% of the collection",
// cumulative from rarest to most common. "common" must always be 100 (catch-all).
export type RarityTierThresholds = Record<TierId, number>;

export const DEFAULT_RARITY_TIERS: RarityTierThresholds = {
  mythic:    0.1,
  legendary: 0.5,
  epic:      2.5,
  rare:      10,
  uncommon:  30,
  common:    100,
};

interface TierVisual {
  label: string;
  emoji: string;
  symbol: string;        // decorative prefix used in the tier banner pill: ✦ ★ ◆ ▲ ✦ ○
  accent: string;        // representative hex — rank-pct text, trait dot fill, tier-tag text
  hasSparkles: boolean;  // whether to render animated sparkle crosses in the panel (mythic + epic)
}

const TIER_VISUALS: Record<TierId, TierVisual> = {
  mythic: {
    label: "Mythic",
    emoji: "✨",
    symbol: "✦",
    accent: "#cc66ff",
    hasSparkles: true,
  },
  legendary: {
    label: "Legendary",
    emoji: "👑",
    symbol: "★",
    accent: "#f0c000",
    hasSparkles: false,
  },
  epic: {
    label: "Epic",
    emoji: "💎",
    symbol: "◆",
    accent: "#a8d0ff",
    hasSparkles: true,
  },
  rare: {
    label: "Rare",
    emoji: "🔥",
    symbol: "▲",
    accent: "#ff6060",
    hasSparkles: false,
  },
  uncommon: {
    label: "Uncommon",
    emoji: "🌿",
    symbol: "✦",
    accent: "#5fce7a",
    hasSparkles: false,
  },
  common: {
    label: "Common",
    emoji: "○",
    symbol: "○",
    accent: "#6090e0",
    hasSparkles: false,
  },
};

export interface RarityTier extends TierVisual {
  id: TierId;
  rank: number | null;
  totalSupply: number;
  percentile: number | null; // 0-100, e.g. 0.67 means "top 0.67%"
  percentileLabel: string;   // "Top 0.67%" / "Unranked"
}

export function formatPercentile(percentile: number): string {
  const decimals = percentile >= 10 ? 0 : percentile >= 1 ? 1 : 2;
  return `Top ${percentile.toFixed(decimals)}%`;
}

// Shared bucketing rule — used for both whole-NFT rank percentiles and per-trait rarity.
export function tierIdForPercentile(
  percentile: number,
  thresholds: RarityTierThresholds = DEFAULT_RARITY_TIERS
): TierId {
  return TIER_ORDER.find((tierId) => percentile <= thresholds[tierId]) ?? "common";
}

// Visual-only lookup — for tagging a single trait or any percentile value.
export function getTierVisual(id: TierId): TierVisual {
  return TIER_VISUALS[id];
}

// Merges a collection's custom percentages over the defaults.
export function resolveTierThresholds(
  overrides?: Partial<RarityTierThresholds> | null
): RarityTierThresholds {
  if (!overrides) return DEFAULT_RARITY_TIERS;
  return { ...DEFAULT_RARITY_TIERS, ...overrides };
}

// rank is 1-indexed (rank 1 = single rarest item). Falls back to "Common"/"Unranked" if rank or
// totalSupply is missing.
export function getRarityTier(
  rank: number | null,
  totalSupply: number,
  thresholds: RarityTierThresholds = DEFAULT_RARITY_TIERS
): RarityTier {
  if (!rank || rank < 1 || !totalSupply || totalSupply < 1) {
    return {
      ...TIER_VISUALS.common,
      id: "common",
      rank: rank ?? null,
      totalSupply,
      percentile: null,
      percentileLabel: "Unranked",
    };
  }

  const percentile = (rank / totalSupply) * 100;
  const id = tierIdForPercentile(percentile, thresholds);

  return {
    ...TIER_VISUALS[id],
    id,
    rank,
    totalSupply,
    percentile,
    percentileLabel: formatPercentile(percentile),
  };
}
