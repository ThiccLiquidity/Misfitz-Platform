"use client";

import { useMemo, useState } from "react";
import { NftRarityCard } from "@/components/nft/NftRarityCard";
import { NftDetailModal } from "@/components/nft/NftDetailModal";
import { formatXch } from "@/lib/format";
import type { PortfolioGroup, PortfolioNft } from "@/lib/portfolio/service";

type SortKey = "value" | "rarity" | "listed";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Top value" },
  { key: "rarity", label: "Rarest" },
  { key: "listed", label: "Listed first" },
];

function sortItems(items: PortfolioNft[], key: SortKey): PortfolioNft[] {
  const copy = items.slice();
  if (key === "value") {
    copy.sort((a, b) => (b.nft.fairValue?.totalEstimate ?? 0) - (a.nft.fairValue?.totalEstimate ?? 0));
  } else if (key === "rarity") {
    copy.sort((a, b) => (a.nft.rarityRank ?? Infinity) - (b.nft.rarityRank ?? Infinity));
  } else {
    copy.sort((a, b) => {
      const al = a.nft.listing ? 0 : 1;
      const bl = b.nft.listing ? 0 : 1;
      if (al !== bl) return al - bl;
      return (b.nft.fairValue?.totalEstimate ?? 0) - (a.nft.fairValue?.totalEstimate ?? 0);
    });
  }
  return copy;
}

// Client layer over the (server-fetched) holdings: sort, click-to-inspect with the explainable
// value modal, and a copy-link share. Kept separate so the server component stays a pure render.
export function PortfolioGrid({ groups }: { groups: PortfolioGroup[] }) {
  const [sort, setSort] = useState<SortKey>("value");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // launcherId -> item, for resolving the card's onOpen(launcherId) back to a full item.
  const byId = useMemo(() => {
    const m = new Map<string, PortfolioNft>();
    for (const g of groups) for (const it of g.items) m.set(it.nft.launcherId, it);
    return m;
  }, [groups]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-subtle text-xs">Sort</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                sort === s.key
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                  : "text-subtle border-white/10 hover:border-white/25"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={share}
          className="text-subtle rounded-lg border border-white/10 px-3 py-1.5 text-xs transition hover:border-white/25 hover:text-title"
        >
          {copied ? "Link copied ✓" : "Copy share link"}
        </button>
      </div>

      {groups.map((group) => {
        const items = sortItems(group.items, sort);
        return (
          <section key={group.collectionId} className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2">
              <h2 className="text-title text-lg font-semibold">{group.collectionName}</h2>
              <div className="text-subtle text-xs">
                {group.items.length} owned · floor{" "}
                {group.floorXch !== null ? formatXch(group.floorXch) : "—"}
                {group.floorSource !== "none" && (
                  <span className="opacity-70"> (via {group.floorSource})</span>
                )}{" "}
                · est. <span className="text-title font-semibold">{formatXch(group.estimateXch)}</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {items.map((item) => (
                <NftRarityCard
                  key={item.nft.launcherId}
                  nft={item.nft}
                  collectionName={item.collectionName}
                  totalSupply={item.totalSupply}
                  variant="grid"
                  onOpen={(launcherId) => setSelectedId(launcherId)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {selected && (
        <NftDetailModal
          nft={selected.nft}
          collectionName={selected.collectionName}
          totalSupply={selected.totalSupply}
          fullPageHref={null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
