import { formatUsd, formatXch, truncateAddress } from "@/lib/format";
import type { Portfolio } from "@/lib/portfolio/service";
import { PortfolioGrid } from "./PortfolioGrid";

// Server-rendered results: summary banner + notes, then the interactive grid (client).
export function PortfolioResults({ portfolio }: { portfolio: Portfolio }) {
  const { groups, totalCount, totalEstimateXch, totalEstimateUsd, truncated, address } = portfolio;

  if (totalCount === 0) {
    return (
      <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <p className="text-title font-medium">No NFTs found for this address.</p>
        <p className="text-subtle mt-1 text-sm">
          {truncateAddress(address, 10, 6)} doesn&rsquo;t appear to hold any NFTs MintGarden knows about.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-5">
        <div>
          <div className="text-subtle text-xs uppercase tracking-wide">Estimated collection value</div>
          <div className="text-title mt-1 text-3xl font-bold">{formatXch(totalEstimateXch)}</div>
          <div className="text-subtle text-sm">≈ {formatUsd(totalEstimateUsd)}</div>
        </div>
        <div className="text-right">
          <div className="text-title text-lg font-semibold">{totalCount} NFTs</div>
          <div className="text-subtle text-xs">
            {groups.length} collection{groups.length === 1 ? "" : "s"} · {truncateAddress(address, 8, 4)}
          </div>
        </div>
      </div>

      {truncated && (
        <p className="text-subtle mt-3 text-xs">
          Showing your first {totalCount} NFTs — large wallets are capped for now.
        </p>
      )}
      <p className="text-subtle mt-3 text-xs">
        Estimates are our own model (floor + rarity + trait premiums), not offers to buy or sell.
        Tap any NFT to see where its value comes from.
      </p>

      <PortfolioGrid groups={groups} />
    </div>
  );
}
