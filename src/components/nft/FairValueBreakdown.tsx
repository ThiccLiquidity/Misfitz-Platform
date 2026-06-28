import type { FairValueEstimate } from "@/types";

const ROWS: { key: keyof FairValueEstimate; label: string }[] = [
  { key: "floorValue", label: "Base floor value" },
  { key: "rarityPremium", label: "Rarity premium" },
  { key: "traitPremium", label: "Trait premium" },
  { key: "historicalSalesPremium", label: "Historical sales premium" },
  { key: "demandPremium", label: "Market demand premium" },
  { key: "rewardValue", label: "Reward/airdrop value" },
];

// "Never a mystery number" — the product requirement is that an estimate is always shown as its
// components, not just a total. Components not yet computed (sales/demand/reward, v1) render as
// "Not yet tracked" rather than being hidden, so it's clear what's missing, not just absent.
export function FairValueBreakdown({ estimate }: { estimate: FairValueEstimate }) {
  return (
    <div className="rounded-lg border border-page-border p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-title text-sm font-semibold">Fair Value Estimate</span>
        <span className="text-title text-lg font-semibold">{estimate.totalEstimate.toFixed(2)} XCH</span>
      </div>
      <ul className="space-y-1">
        {ROWS.map(({ key, label }) => {
          const value = estimate[key];
          return (
            <li key={key} className="flex justify-between text-xs">
              <span className="text-subtle">{label}</span>
              <span className={typeof value === "number" ? "text-title" : "text-subtle italic"}>
                {typeof value === "number" ? `${value.toFixed(2)} XCH` : "Not yet tracked"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
