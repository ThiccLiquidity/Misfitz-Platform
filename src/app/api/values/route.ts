import { NextResponse } from "next/server";
import { readValueIndex, vidxIsFresh } from "@/lib/valuation/valueIndex";
import { getAllCollectionCards } from "@/lib/collections/liveCollection";
import { keepAlive } from "@/lib/db/nftCache";
import type { ValueEntry } from "@/lib/valuation/valueEntry";

// Cheap value lookup for the portfolio's convergence poll: given held ids grouped by collection, return each
// id's browse-computed value entry from the per-collection index (no per-NFT detail, no comps wait — a couple
// of Redis reads + math). For a collection with NO index yet, kick the shared/locked build in the background
// (writes the index) and report it pending so the client polls again. This replaces the old, expensive
// per-chunk /api/binder retry loop.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { cols?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ values: {}, pending: [] }); }
  const cols = body.cols && typeof body.cols === "object" ? (body.cols as Record<string, unknown>) : {};
  const colIds = Object.keys(cols).filter((c) => c.startsWith("col1")).slice(0, 60);

  const values: Record<string, ValueEntry> = {};
  const pending: string[] = [];
  let asOf = 0; // freshest value-index build time across the held collections (for the "values as of" badge)
  await Promise.all(colIds.map(async (colId) => {
    const idx = await readValueIndex(colId).catch(() => null);
    if (!idx) {
      pending.push(colId);
      keepAlive(getAllCollectionCards(colId).catch(() => null)); // shared cold build; writes the index for next poll
      return;
    }
    if (idx.builtAt > asOf) asOf = idx.builtAt;
    if (!vidxIsFresh(idx)) keepAlive(getAllCollectionCards(colId).catch(() => null)); // serve stale NOW, rebuild for the next poll
    const ids = Array.isArray(cols[colId]) ? (cols[colId] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 600) : [];
    for (const nftId of ids) { const e = idx.values[nftId]; if (e) values[nftId] = e; }
  }));
  return NextResponse.json({ values, pending, asOf: asOf || null }, { headers: { "cache-control": "no-store" } });
}
