import type { Metadata } from "next";

// Public share page for a single SOLD card. Its whole job is to carry Open Graph / Twitter-card metadata
// whose image is our server-rendered SOLD card (/api/og/sold), so when a user posts this link to X (via the
// "Share to X" button on the SoldShowcase), X unfurls the branded card. Keeps the product no-login: we never
// post on the user's behalf — they just hit Post in their own X composer. All sale fields ride in the query
// string so no server lookup is needed. Human visitors see the card + links.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const KEYS = ["name", "coll", "img", "rank", "supply", "price", "usd", "date"] as const;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
function ogQuery(sp: SP): string {
  const q = new URLSearchParams();
  for (const k of KEYS) { const v = first(sp[k]); if (v) q.set(k, v); }
  const traits = sp["trait"];
  const arr = Array.isArray(traits) ? traits : traits ? [traits] : [];
  for (const t of arr) q.append("trait", t);
  return q.toString();
}
const siteBase = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

export async function generateMetadata({ searchParams }: { params: { id: string }; searchParams: SP }): Promise<Metadata> {
  const qs = ogQuery(searchParams);
  const img = `${siteBase()}/api/og/sold?${qs}`; // absolute in prod (NEXT_PUBLIC_SITE_URL) so X can crawl it
  const name = first(searchParams.name) || "A Misfit";
  const price = first(searchParams.price);
  const priceStr = price && Number.isFinite(Number(price)) ? ` for ${Number(price).toFixed(2)} XCH` : "";
  const title = `${name} — SOLD${priceStr}`;
  const description = "See the sale on Traitfolio — the Chia NFT collector's binder.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: img, width: 720, height: 1120 }] },
    twitter: { card: "summary_large_image", title, description, images: [img] },
  };
}

export default function SharePage({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  const img = `/api/og/sold?${ogQuery(searchParams)}`;
  const id = params.id;
  const mg = id && id.startsWith("nft1") ? `https://mintgarden.io/nfts/${id}` : null;
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
