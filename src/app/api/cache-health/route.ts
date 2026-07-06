import { NextResponse } from "next/server";
import { redisHealth } from "@/lib/db/nftCache";

// Diagnostic endpoint: GET /api/cache-health -> JSON telling us whether the shared Redis (Upstash/Vercel-KV)
// layer is actually live in production. Safe: leaks no secrets (only the URL host + booleans). Calling it
// performs a real set+get, so a healthy response also bumps the Redis command counter.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const h = await redisHealth();
  return NextResponse.json(h, { headers: { "cache-control": "no-store" } });
}
