import { renderSoldCardPng } from "@/lib/social/soldCard";
import type { SaleForPost } from "@/lib/social/types";

// Public design-preview of the server-rendered SOLD card. Renders a card PNG straight from query params so
// the card layout can be eyeballed in a browser without needing a real sale or the X credentials. Purely
// cosmetic (renders an image from the given params); posts nothing.
//   /api/og/sold?name=Misfitz%20%23204&price=4.2&rank=57&supply=4444&img=https://...&coll=Misfitz
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const traits: { type: string; value: string }[] = [];
  for (const raw of q.getAll("trait")) {
    const [type, ...rest] = raw.split(":");
    if (type && rest.length) traits.push({ type: type.trim(), value: rest.join(":").trim() });
  }
  const sale: SaleForPost = {
    nftId: "preview",
    launcherId: null,
    name: (q.get("name") || "Misfitz #204").slice(0, 80),
    collectionName: q.get("coll"),
    imageUrl: q.get("img"),
    rank: num(q.get("rank")),
    totalSupply: num(q.get("supply")),
    priceXch: num(q.get("price")) ?? 4.2,
    priceUsd: num(q.get("usd")),
    date: q.get("date") || new Date().toISOString(),
    traits: traits.slice(0, 3),
  };
  try {
    const png = await renderSoldCardPng(sale);
    return new Response(Buffer.from(png), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response(`render error: ${String((e as Error)?.message ?? e)}`, { status: 500 });
  }
}
