import type { Metadata } from "next";
import { getNftDetail } from "@/lib/data-sources/mintgarden/client";
import { mapDetailToNftData } from "@/lib/data-sources/mintgarden/map";
import { fetchCollectionCompletedSales, fetchXchUsdRate } from "@/lib/market/dexie";
import type { SaleForPost } from "@/lib/social/types";

// Public share page for a single SOLD card. The URL stays CLEAN: /s/<launcherId> (or hex item id) with NO
// query string. This page fetches the sale SERVER-SIDE from that id, then emits Open Graph / Twitter-card
// metadata whose image is our server-rendered SOLD card (/api/og/sold, built here from the fetched fields),
// so X unfurls the branded card. Product stays no-login: we never post for the user — the "Share to X"
// button just opens their composer with this link. Human visitors see the card + a MintGarden link.
//
// NOTE: the og:image MUST be absolute for X's crawler to fetch it — set NEXT_PUBLIC_SITE_URL to the real
// production origin in Vercel. (X also only unfurls the PUBLIC prod URL; password-protected Vercel *preview*
// deploys return a login page, which is why a preview link unfurls as the generic "Overview – Vercel" card.)
export const dynamic = "force-dynamic";

const siteBase = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

// Fetch the NFT + its latest clean-XCH sale from just the id. NEVER throws — X's crawler must always get a
// card; on any miss we fall back to whatever fields we have (the og route renders a placeholder if empty).
async function loadSale(id: string): Promise<SaleForPost | null> {
  if (!id) return null;
  try {
    const detail = await getNftDetail(id).catch(() => null);
    if (!detail) return null;
    const rate = await fetchXchUsdRate().catch(() => null);
    const { nft, collectionId, collectionName, totalSupply } = mapDetailToNftData(detail, rate ?? undefined);

    // Latest completed sale for THIS exact NFT. Same join the recent-sales rail uses:
    // CompletedSale.id (hex launcher) === nft.id (MintGarden item id, hex).
    let priceXch = 0;
    let date = "";
    if (collectionId.startsWith("col1")) {
      const sales = await fetchCollectionCompletedSales(collectionId).catch(() => []);
      const mine = sales
        .filter((s) => s.id.toLowerCase() === nft.id.toLowerCase() && s.price > 0 && !!s.date)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
      if (mine.length) { priceXch = mine[0].price; date = mine[0].date; }
    }
    // Fallback: the on-chain sale history carried on the NFT itself.
    if (priceXch <= 0 && nft.recentSales && nft.recentSales.length) {
      priceXch = nft.recentSales[0].priceXch;
      date = nft.recentSales[0].date ?? "";
    }

    // USD only when the sale is recent (<=7 days) and we have a rate — mirrors the on-screen card.
    let priceUsd: number | null = null;
    if (rate && priceXch > 0 && date) {
      const ageDays = (Date.now() - Date.parse(date)) / 86_400_000;
      if (Number.isFinite(ageDays) && ageDays <= 7) priceUsd = Math.round(priceXch * rate * 100) / 100;
    }

    return {
      nftId: nft.id,
      launcherId: nft.launcherId || null,
      name: nft.name,
      collectionName: collectionName || null,
      imageUrl: nft.imageUrl || null,
      rank: nft.rarityRank,
      totalSupply: totalSupply || null,
      priceXch,
      priceUsd,
      date: date || new Date().toISOString(),
      traits: (nft.traits ?? []).slice(0, 3).map((t) => ({ type: t.trait_type, value: String(t.value) })),
    };
  } catch {
    return null;
  }
}

// Build the /api/og/sold query the card renderer reads, from the server-fetched sale.
function ogQuery(s: SaleForPost | null): string {
  const q = new URLSearchParams();
  if (!s) return q.toString();
  if (s.name) q.set("name", s.name);
  if (s.collectionName) q.set("coll", s.collectionName);
  if (s.imageUrl) q.set("img", s.imageUrl);
  if (s.rank != null) q.set("rank", String(s.rank));
  if (s.totalSupply != null) q.set("supply", String(s.totalSupply));
  if (s.priceXch > 0) q.set("price", String(s.priceXch));
  if (s.priceUsd != null) q.set("usd", String(s.priceUsd));
  if (s.date) q.set("date", s.date);
  for (const t of s.traits) q.append("trait", `${t.type}:${t.value}`);
  return q.toString();
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const sale = await loadSale(params.id);
  const qs = ogQuery(sale);
  const img = `${siteBase()}/api/og/sold${qs ? `?${qs}` : ""}`; // absolute in prod (NEXT_PUBLIC_SITE_URL) so X can crawl it
  const name = sale?.name || "A Chia NFT";
  const priceStr = sale && sale.priceXch > 0 ? ` for ${sale.priceXch.toFixed(2)} XCH` : "";
  const title = `${name} — SOLD${priceStr}`;
  const description = "See the sale on Traitfolio — the Chia NFT collector's binder.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: img, width: 720, height: 1120 }] },
    twitter: { card: "summary_large_image", title, description, images: [img] },
  };
}

export default async function SharePage({ params }: { params: { id: string } }) {
  const sale = await loadSale(params.id);
  const qs = ogQuery(sale);
  const img = `/api/og/sold${qs ? `?${qs}` : ""}`;
  const mgId = sale?.launcherId || (params.id.startsWith("nft1") ? params.id : null);
  const mg = mgId ? `https://mintgarden.io/nfts/${mgId}` : null;
  const linkStyle = { padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: "none" } as const;

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingBottom: 32 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img} alt="SOLD card" style={{ width: "100%", borderRadius: 16, border: "1px solid rgba(255,224,106,0.25)" }} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {mg && (
          <a href={mg} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, background: "rgba(255,224,106,0.12)", border: "1px solid rgba(255,224,106,0.35)", color: "var(--gold)" }}>
            View on MintGarden
          </a>
        )}
        <a href="/browse" style={{ ...linkStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "var(--title)" }}>
          Explore Traitfolio
        </a>
      </div>
    </div>
  );
}
