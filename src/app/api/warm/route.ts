import { NextResponse } from "next/server";
import { getTrendingCollections } from "@/lib/collections/discovery";
import { getAllCollectionCards } from "@/lib/collections/liveCollection";
import { getCollectionFrequency } from "@/lib/rarity/collectionFrequency";
import { getCompsModel } from "@/lib/valuation/compsService";

// Nightly "top-collection treatment" warmer. Gives the top-N-by-volume collections the same instant,
// pre-computed experience Misfitz gets from its seed: our OpenRarity rank table, the roster scan, and the
// comparable-sales model are all built AHEAD of the first visitor and persisted to shared Redis — so nobody
// pays the cold 30-70s scan on a real page view. Reuses the exact engines the live pages use; adds no new
// valuation logic. Triggered by a Vercel Cron (see vercel.json) and self-chains ONE collection per
// invocation so each stays within the 60s function budget.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOP_N = 50;
const WARM_BUDGET_MS = 45_000; // cap the heavy work so we always have time to chain + respond

// Only a caller holding CRON_SECRET may trigger this (Vercel Cron auto-sends it as a Bearer token when the
// env var is set; the self-chain forwards the same). Without a secret configured we refuse — these scans
// are expensive and must never be publicly triggerable.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function keepAlive(p: Promise<unknown>): Promise<void> {
  const safe = p.catch(() => { /* ignore */ });
  try { const m = "@vercel/functions"; const mod = await import(m); (mod as { waitUntil?: (x: Promise<unknown>) => void }).waitUntil?.(safe); }
  catch { void safe; }
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const i = Math.max(0, Number(url.searchParams.get("i") ?? "0") | 0);

  const trending = await getTrendingCollections(TOP_N).catch(() => []);
  const ids = trending.map((c) => c.id).filter((id): id is string => typeof id === "string" && id.startsWith("col1"));
  if (i >= ids.length) return NextResponse.json({ ok: true, done: true, count: ids.length });

  const id = ids[i];
  const t0 = Date.now();
  const result = { roster: false, rarity: false, comps: false };
  // All three persist to Redis. Bounded by a shared budget so one slow collection can't blow the function
  // (its build keeps running after we respond and may still land in cache — pure upside).
  await withBudget((async () => {
    try { await getAllCollectionCards(id); result.roster = true; } catch { /* best effort */ }
    try { const r = await getCollectionFrequency(id, { wait: true }); result.rarity = !!r; } catch { /* best effort */ }
    try { const m = await getCompsModel(id, { wait: true }); result.comps = !!m; } catch { /* best effort */ }
  })(), WARM_BUDGET_MS);
  const ms = Date.now() - t0;

  // Chain the next collection as its own fresh-budget invocation, kept alive past this response.
  const next = i + 1;
  if (next < ids.length) {
    const secret = process.env.CRON_SECRET as string;
    await keepAlive(fetch(`${url.origin}/api/warm?i=${next}`, { headers: { authorization: `Bearer ${secret}` } }));
  }

  return NextResponse.json({ ok: true, i, id, ms, result, remaining: Math.max(0, ids.length - next) });
}
