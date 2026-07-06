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
  const attempt = Math.max(0, Number(url.searchParams.get("a") ?? "0") | 0);

  const trending = await getTrendingCollections(TOP_N).catch(() => []);
  const ids = trending.map((c) => c.id).filter((id): id is string => typeof id === "string" && id.startsWith("col1"));
  if (i >= ids.length) return NextResponse.json({ ok: true, done: true, count: ids.length });

  const id = ids[i];
  const t0 = Date.now();
  const result = { roster: false, rarity: false, comps: false };
  // All three persist to Redis. Bounded by a shared budget so one slow collection can't blow the function
  // (its build keeps running after we respond and may still land in cache — pure upside).
  await withBudget((async () => {
    // One roster slice per invocation (the ?a= chain resumes the rest); don't start a 2nd slice that would
    // be killed at the 60s cap and leak the lock.
    try { for (let k = 0; k < 30; k++) { const rr = await getAllCollectionCards(id); if (!rr.warming) { result.roster = true; break; } if (Date.now() - t0 > 6_000) break; } } catch { /* best effort */ }
    // Only build rarity + comps once the roster is COMPLETE — otherwise getCollectionFrequency would launch
    // its own un-timeboxed full scan that dies at 60s and wastes rate budget.
    if (result.roster) {
      try { const r = await getCollectionFrequency(id, { wait: true }); result.rarity = !!r; } catch { /* best effort */ }
      try { const m = await getCompsModel(id, { wait: true }); result.comps = !!m; } catch { /* best effort */ }
    }
  })(), WARM_BUDGET_MS);
  const ms = Date.now() - t0;

  // If the roster didn't finish this pass (big collection, time-boxed), RESUME the same collection next
  // invocation (its scan is checkpointed) — up to a few attempts — before moving on. Otherwise advance.
  let nextI = i + 1, nextA = 0;
  if (!result.roster && attempt < 4) { nextI = i; nextA = attempt + 1; }
  if (nextI < ids.length) {
    const secret = process.env.CRON_SECRET as string;
    await keepAlive(fetch(`${url.origin}/api/warm?i=${nextI}&a=${nextA}`, { headers: { authorization: `Bearer ${secret}` } }));
  }

  return NextResponse.json({ ok: true, i, attempt, id, ms, result, resuming: nextI === i });
}
