import { NextResponse } from "next/server";
import { listAddressNfts, getCollection } from "@/lib/data-sources/mintgarden/client";
import { mapListItemToCard, isDisplayableNft } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, XCH_USD_FALLBACK } from "@/lib/market/dexie";
import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";
import { resolveTrustedFloorWarm } from "@/lib/market/floorTrust";
import type { MgCollection } from "@/lib/data-sources/mintgarden/types";
import type { NftData } from "@/types";

// ONE upstream page per request — the reliable building block of client-orchestrated wallet loading. The
// browser drives the cursor loop, so each invocation is O(1): a single ~440ms MintGarden fetch (proven fast in
// prod), map to slim cards, resolve only this page's few new collections (cached), return. No lock, no
// server-side cursor state, no growing checkpoint, no per-poll reprocessing — the whole class of timeout / OOM /
// oversized-response / stuck-lock failures is structurally impossible here. Traits + values backfill via the
// existing /api/binder enrichment and /api/values convergence, exactly as they do for xch1 wallets today.
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") || "").trim().toLowerCase();
  const cursor = url.searchParams.get("cursor") || undefined;
  if (!address || !isValidChiaOwnerId(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });

  try {
    const [rate, page] = await Promise.all([
      fetchXchUsdRate().catch(() => XCH_USD_FALLBACK),
      // Metadata-free page: small + fast (~220ms), and traits arrive via enrichment anyway. Keeps every reply
      // tiny and every fetch quick, so the client loop never trips a timeout or a response-size limit.
      listAddressNfts(address, cursor, 50, "owned", true, false, false),
    ]);
    const xchUsdRate = rate ?? XCH_USD_FALLBACK;
    const items = (page.items ?? []).filter((it) =>
      isDisplayableNft({ is_blocked: it.is_blocked, blocked_content: it.collection_blocked_content }),
    );

    // Resolve only the DISTINCT collections seen on THIS page (getCollection is Redis-cached; a page spans a
    // handful of collections at most). Misses map to supply 0 and backfill on a later page — never a blocker.
    const colIds = Array.from(new Set(items.map((i) => i.collection_id)));
    const cols = await Promise.all(colIds.map((id) => getCollection(id).catch(() => null)));
    const colMap = new Map<string, MgCollection>();
    colIds.forEach((id, i) => { const c = cols[i]; if (c) colMap.set(id, c); });

    const cards: NftData[] = [];
    for (const it of items) {
      try {
        const col = colMap.get(it.collection_id);
        const mgFloor = typeof col?.floor_price === "number" ? col.floor_price : null;
        // TRUSTED floor: unpriced (null) for troll/no-sale collections; refined again by /api/values later.
        const floor = resolveTrustedFloorWarm(it.collection_id, mgFloor).valueFloor;
        const m = mapListItemToCard(it, col, floor, xchUsdRate);
        cards.push({ ...m.nft, totalSupply: m.totalSupply, collectionName: m.collectionName });
      } catch { /* skip one malformed item, never fail the page */ }
    }

    return NextResponse.json(
      { cards, nextCursor: page.next ?? null, done: !page.next, xchUsdRate },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // Never 500: tell the client to retry this same cursor. One flaky upstream page can't stall the scan.
    return NextResponse.json(
      { cards: [], nextCursor: cursor ?? null, done: false, retry: true, error: String((e as Error)?.message ?? e) },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
