// Tang Gang lookups (CLIENT-SAFE — the data is public community info, bundled from the dev's file). Gated by
// NEXT_PUBLIC_TANG_GANG so the badges stay hidden until launch. This module only answers "is this a Tang Gang
// collection and what's its peel-point rating" — a wallet TOTAL waits on the dev confirming the earn unit.
import { TANG_COLLECTIONS, TANG_SPECIAL, type TangCollection } from "./tangData";

export function isTangEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_TANG_GANG;
  return v === "1" || v === "true";
}

export function tangFor(colId: string | null | undefined): TangCollection | null {
  if (!colId || !isTangEnabled()) return null;
  return TANG_COLLECTIONS[colId] ?? null;
}

export function isTang(colId: string | null | undefined): boolean {
  return tangFor(colId) != null;
}

// Map of specific NFT id -> its special peel-point grant (AlphaBear / SigmaBear / Cryptic Alliance).
const SPECIAL_BY_NFT: Map<string, { key: string; name: string; pp: number }> = (() => {
  const m = new Map<string, { key: string; name: string; pp: number }>();
  for (const s of TANG_SPECIAL) for (const id of s.nftIds) m.set(id, { key: s.key, name: s.name, pp: s.pp });
  return m;
})();

export function tangSpecialForNft(nftId: string | null | undefined): { key: string; name: string; pp: number } | null {
  if (!nftId || !isTangEnabled()) return null;
  return SPECIAL_BY_NFT.get(nftId) ?? null;
}

export const TANG_COLLECTION_COUNT = Object.keys(TANG_COLLECTIONS).length;
export const TANG_SITE_URL = "https://www.tanggangchia.com";
export const TANG_DISCORD_URL = "https://discord.gg/9fFvWaCzd";
// Official $PP CAT icon hosted on Dexie's CDN (asset id 84d31c8…). Used as the peel-points logo across the app.
export const PP_LOGO_URL = "https://icons.dexie.space/84d31c80c619070ba45ce4dc5cc0bed2ae4341a0da1d69504e28243e6ccbef37.webp";

// ── Weekly peel-point total for a wallet ─────────────────────────────────────────
// Per the Tang Gang dev: peel points are PER NFT and snapshotted weekly. We sum each held Tang NFT's collection
// rate, plus any special-NFT bonuses. We only count NFT-based points — never token/CAT balances (incl. $PP).
export interface PeelRow { colId: string; name: string; ppPerNft: number; count: number; subtotal: number }
export interface WalletPeel { total: number; rows: PeelRow[]; specialTotal: number; tangNftCount: number }

export function walletPeelPoints(nfts: { collectionSlug?: string | null; launcherId?: string | null }[]): WalletPeel {
  const byCol = new Map<string, PeelRow>();
  let specialTotal = 0;
  let tangNftCount = 0;
  for (const n of nfts) {
    const t = tangFor(n.collectionSlug);
    if (t && n.collectionSlug) {
      const row = byCol.get(n.collectionSlug) ?? { colId: n.collectionSlug, name: t.name, ppPerNft: t.pp, count: 0, subtotal: 0 };
      row.count += 1;
      row.subtotal += t.pp;
      byCol.set(n.collectionSlug, row);
      tangNftCount += 1;
    }
    const sp = tangSpecialForNft(n.launcherId);
    if (sp) specialTotal += sp.pp; // extra bonus for the specific listed NFTs (AlphaBear / SigmaBear / Cryptic Alliance)
  }
  const rows = [...byCol.values()].sort((a, b) => b.subtotal - a.subtotal);
  const total = rows.reduce((s, r) => s + r.subtotal, 0) + specialTotal;
  return { total, rows, specialTotal, tangNftCount };
}
