import { NftRarityCard } from "@/components/nft/NftRarityCard";
import { formatUsd, formatXch, truncateAddress } from "@/lib/format";
import type { Portfolio } from "@/lib/portfolio/service";

// Server-rendered results for a valued address. Summary banner + one section per collection.
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
      {/* Summary */}
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
      </p>

      {/* Per-collection sections */}
      {groups.map((group) => (
        <section key={group.collectionId} className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2">
            <h2 className="text-title text-lg font-semibold">{group.collectionName}</h2>
            <div className="text-subtle text-xs">
              {group.items.length} owned · floor{" "}
              {group.floorXch !== null ? formatXch(group.floorXch) : "—"} · est.{" "}
              <span className="text-title font-semibold">{formatXch(group.estimateXch)}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {group.items.map((item) => (
              <NftRarityCard
                key={item.nft.launcherId}
                nft={item.nft}
                collectionName={item.collectionName}
                totalSupply={item.totalSupply}
                variant="grid"
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
