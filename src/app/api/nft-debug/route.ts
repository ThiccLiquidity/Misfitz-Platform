import { NextResponse } from "next/server";
import { getAllCollectionCards } from "@/lib/collections/liveCollection";
import { enrichNftsByIds } from "@/lib/portfolio/service";
import { isSeeded, getSeed } from "@/lib/data-sources/seed/registry";
import { fetchXchUsdRate, XCH_USD_FALLBACK } from "@/lib/market/dexie";
import type { NftData } from "@/types";

// Debug: GET /api/nft-debug[?col=col1...] -> the ACTUAL shape of a Misfitz card as produced by (a) the
// collection path (getAllCollectionCards) and (b) the wallet/enrichment path (enrichNftsByIds), so we can
// see exactly where rank / totalSupply / per-trait rarityPercent are (or aren't) set. Safe, read-only.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const MISFITZ = "col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh";

function slim(n: NftData | null | undefined) {
  if (!n) return null;
  return {
    name: n.name,
    rarityRank: n.rarityRank,
    rankEstimated: n.rankEstimated,
    totalSupply: n.totalSupply,
    traits: (n.traits ?? []).map((t) => ({ t: t.trait_type, v: t.value, pct: t.rarityPercent })),
  };
}

export async function GET(req: Request) {
  const col = new URL(req.url).searchParams.get("col") ?? MISFITZ;
  const seed = await getSeed(col).catch(() => null);
  const all = await getAllCollectionCards(col).catch(() => null);
  const cards = all?.nfts ?? [];
  const first = cards.find((n) => /#0*1204(\D|$)/.test(n.name)) ?? cards[0] ?? null;

  let fromEnrich = null;
  if (first) {
    const rate = (await fetchXchUsdRate().catch(() => null)) ?? XCH_USD_FALLBACK;
    const e = await enrichNftsByIds([first.launcherId], {}, rate).catch(() => []);
    fromEnrich = slim(e[0]);
  }

  return NextResponse.json(
    {
      col,
      seeded: isSeeded(col),
      seedLoaded: !!seed,
      seedSupply: seed?.supply ?? null,
      cardCount: cards.length,
      warming: all?.warming ?? null,
      fromAll: slim(first),      // what the collection page renders
      fromEnrich,                // what the wallet / binder enrichment renders
    },
    { headers: { "cache-control": "no-store" } },
  );
}
