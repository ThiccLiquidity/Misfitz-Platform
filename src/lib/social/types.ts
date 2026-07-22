// Shared shape for a sale we're about to celebrate. Built in autopost.ts by joining a Dexie completed sale
// to its enriched card, and consumed by both the caption generator and the server-side card renderer.
export interface SaleForPost {
  nftId: string;             // MintGarden item id (hex) — the sales↔card join key
  launcherId: string | null; // nft1... bech32 id — powers the MintGarden link
  name: string;
  collectionName: string | null;
  imageUrl: string | null;   // absolute art URL (Satori fetches it directly)
  rank: number | null;
  totalSupply: number | null;
  priceXch: number;
  priceUsd: number | null;   // only when the sale is recent + we have a rate
  date: string;              // ISO completion date
  traits: { type: string; value: string }[]; // top few, for chips + caption flavor
}

// A stable per-sale key for the post-once sentinel: a sale is uniquely a (NFT, completion-date) pair.
export function saleKey(s: Pick<SaleForPost, "nftId" | "date">): string {
  return `${s.nftId}:${s.date}`;
}
