import { NextResponse } from "next/server";
import { redisHealth, redisStats } from "@/lib/db/nftCache";
import { isSeeded, getSeed } from "@/lib/data-sources/seed/registry";

// One-stop health + storage check: GET /api/status. Tells you (a) the shared cache is alive and writing,
// (b) the Misfitz seed is loaded, and (c) WHAT is filling Redis (rosters vs comps vs leftover details) so
// you know if/when to upgrade. Safe: no secrets, only counts. Read the actual MB on the Upstash dashboard.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const MISFITZ = "col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh";
const FREE_TIER_KEY_HINT = 20000; // rough: past this many keys, watch the Upstash storage gauge

export async function GET() {
  const [health, stats, seed] = await Promise.all([
    redisHealth(),
    redisStats(),
    getSeed(MISFITZ).catch(() => null),
  ]);

  const details = stats.byPrefix.detail ?? 0;
  const notes: string[] = [];
  if (!health.configured) notes.push("Redis env vars not detected — the shared cache is OFF (every load hits the network).");
  else if (!health.roundTrip) notes.push("Redis is configured but a read/write test failed — cache not usable right now.");
  if (details > 5000) notes.push(`~${details} per-NFT detail keys — details are slimmed + 48h-capped; if this dominates, comps detail churn is the cause.`);
  if (stats.dbsize > FREE_TIER_KEY_HINT) notes.push(`~${stats.dbsize} keys — check the Upstash STORAGE gauge; if it's near 256MB, trim rosters or upgrade.`);
  if (notes.length === 0) notes.push("Healthy. Cache alive, details staying out of Redis. Watch the Upstash STORAGE gauge as traffic grows.");

  const ok = health.configured && health.roundTrip;
  return NextResponse.json(
    {
      ok,
      redis: {
        configured: health.configured,
        writesWork: health.roundTrip,
        waitUntil: health.waitUntil,
        host: health.urlHost,
        totalKeys: stats.dbsize,
        countedKeys: stats.scanned,
        countComplete: stats.complete,
        byKind: stats.byPrefix, // roster / comps / rarity / portfolio / holdings / detail / ...
      },
      seed: { enabled: isSeeded(MISFITZ), misfitzLoaded: !!seed, misfitzCount: seed ? Object.keys(seed.byNumber).length : 0 },
      notes,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
