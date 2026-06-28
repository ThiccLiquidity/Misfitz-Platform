interface RarityBadgeProps {
  rank: number | null;
  totalSupply?: number;
}

export function RarityBadge({ rank, totalSupply }: RarityBadgeProps) {
  if (rank === null) return null;
  return (
    <span className="text-subtle text-[10px]">
      Rank {rank}
      {totalSupply ? ` / ${totalSupply}` : ""}
    </span>
  );
}
