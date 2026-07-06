import { NextResponse } from "next/server";
import { isSeeded, getSeed } from "@/lib/data-sources/seed/registry";

// Diagnostic: GET /api/seed-health[?col=col1...] -> is the seed layer actually active + loading in prod.
// `enabled` = the TRAITFOLIO_SEED env flag reached the runtime. `seeded` = this collection has a loader.
// `loaded`/`count` = the bundled JSON actually imported (a false here with enabled=true means a bundling
// problem, exactly like the Redis package bug). Safe: exposes only counts + one sample entry.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MISFITZ = "col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh";

export async function GET(req: Request) {
  const col = new URL(req.url).searchParams.get("col") ?? MISFITZ;
  const enabled = process.env.TRAITFOLIO_SEED === "1";
  const seeded = isSeeded(col);
  let loaded = false, count = 0, supply = 0;
  let sample: unknown = null, error: string | undefined;
  try {
    const s = await getSeed(col);
    if (s) {
      loaded = true;
      count = Object.keys(s.byNumber).length;
      supply = s.supply;
      const k = Object.keys(s.byNumber)[0];
      sample = k ? { key: k, ...s.byNumber[k] } : null;
    }
  } catch (e) { error = (e as Error)?.message ?? String(e); }
  return NextResponse.json(
    { col, enabled, seeded, loaded, count, supply, sample, error },
    { headers: { "cache-control": "no-store" } },
  );
}
