// MisFitz Rewards — LIVE holder-snapshot bridge for the $TOKEN drip. Pages the collection roster from
// MintGarden, reads each NFT's CURRENT owner + rank, and hands the snapshot to the pure allocator. Imports the
// app data layer (like detectLive.ts) so it's kept OUT of the unit-tested pure module. Moves no funds.
//
// Snapshot rule (operator decision): FIXED date — take this on the 1st of the month. LISTED NFTs still count
// (owner is still the holder until an offer is taken). Rarity-weighted per NFT via the shared valuation curve.
//
// PRE-LAUNCH NOTE: owner comes from MintGarden's collection listing. Before real payouts, the 1st-of-month
// snapshot must be pinned to a specific BLOCK (or re-verified on-chain) so it can't drift or be disputed —
// this preview reads "owner as of now", which is only exact if run at the snapshot moment.

import { getCollection, listCollectionNfts } from "@/lib/data-sources/mintgarden/client";
import { getSeed, numberFromName } from "@/lib/data-sources/seed/registry";
import { allocateDrip, weighHoldings, type DripResult, type SnapshotNft } from "./allocator";

export async function snapshotHolders(colId: string, maxPages = 200): Promise<SnapshotNft[]> {
  const [col, seed] = await Promise.all([getCollection(colId).catch(() => null), getSeed(colId).catch(() => null)]);
  const supply = typeof col?.nft_count === "number" && col.nft_count > 0
    ? col.nft_count
    : seed ? Object.keys(seed.byNumber).length : 0;
  const out: SnapshotNft[] = [];
  let cursor: string | null | undefined = undefined;
  let pages = 0;
  let noOwner = 0;
  do {
    const page: Awaited<ReturnType<typeof listCollectionNfts>> | null =
      await listCollectionNfts(colId, cursor, 100, false, true).catch(() => null); // include_metadata for the name
    if (!page) break;
    for (const it of page.items ?? []) {
      const wallet = it.owner_address_encoded_id ?? null;
      if (!wallet) { noOwner += 1; continue; }
      let rank: number | null = null;
      const num = numberFromName(it.name ?? "");
      if (seed && num != null) rank = seed.byNumber[String(num)]?.rank ?? null;
      if (rank == null) { const r = Number(it.openrarity_rank); rank = Number.isFinite(r) && r > 0 ? r : null; }
      out.push({ wallet, rank, supply });
    }
    cursor = page.next;
    pages += 1;
  } while (cursor && pages < maxPages);
  if (noOwner) console.warn(`[rewards] snapshotHolders: ${noOwner} NFTs had no owner in the listing — snapshot may be partial.`);
  return out;
}

// Preview one month's drip: snapshot holders -> rarity weights -> proportional allocation. Pure allocator does
// the money math; this just assembles the live snapshot. dripUnits = smallest $TOKEN units released this month.
export async function runDripPreview(colId: string, dripUnits: bigint): Promise<DripResult> {
  const snap = await snapshotHolders(colId);
  return allocateDrip(weighHoldings(snap), dripUnits);
}
