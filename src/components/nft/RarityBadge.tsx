import type { RarityTier } from "@/lib/rarity/tiers";

interface RarityBadgeProps {
  tier: RarityTier;
}

// Always shows rank, percentile, and tier (including "Common") per product direction — unlike
// the old version, "Common" is no longer hidden. The tier object already carries everything
// needed (label/emoji/percentileLabel), computed once by the caller via getRarityTier.
export function RarityBadge({ tier }: RarityBadgeProps) {
  if (tier.rank === null) return null;

  return (
    <div className="flex flex-col leading-tight">
      <span className="text-subtle text-[9px]">Rank #{tier.rank}</span>
      <span className="text-subtle text-[9px]">{tier.percentileLabel}</span>
      <span className="text-[9px] font-bold uppercase tracking-wide text-title">
        {tier.emoji} {tier.label}
      </span>
    </div>
  );
}
