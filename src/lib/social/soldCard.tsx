import { ImageResponse } from "next/og";
import { getRarityTier } from "@/lib/rarity/tiers";
import { formatUsd, timeAgo } from "@/lib/format";
import type { SaleForPost } from "./types";

// Server-side render of the shareable "SOLD" card as a PNG (next/og / Satori). A faithful mirror of the
// in-app SoldShowcase canvas (src/components/nft/SoldShowcase.tsx -> drawCard): same 720-wide layout, navy
// gradient, top-left tier badge, diagonal gold "SOLD" corner ribbon, and centered text flow. Rendered
// headlessly so the auto-poster + share links never need a browser or a screenshot.

const W = 720;
const ART = 720;

function fullDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
function safeArt(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null; // Satori can only fetch http(s) art
}

// Load a real weighted sans so headings render heavy (Satori has no synthetic bold). Fetched once, cached in
// module memory, fully optional -> any failure falls back to next/og's built-in font so a render never breaks.
let _fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: "normal" }[]> | null = null;
function loadFonts() {
  if (_fonts) return _fonts;
  const base = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files";
  const want: { w: 400 | 700 | 900; f: string }[] = [
    { w: 400, f: "inter-latin-400-normal.woff" },
    { w: 700, f: "inter-latin-700-normal.woff" },
    { w: 900, f: "inter-latin-900-normal.woff" },
  ];
  _fonts = (async () => {
    const out: { name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: "normal" }[] = [];
    await Promise.all(
      want.map(async ({ w, f }) => {
        try {
          const r = await fetch(`${base}/${f}`, { cache: "force-cache" as RequestCache });
          if (r.ok) out.push({ name: "Inter", data: await r.arrayBuffer(), weight: w, style: "normal" });
        } catch { /* fall back to default font */ }
      })
    );
    return out;
  })();
  return _fonts;
}

export async function renderSoldCardPng(sale: SaleForPost): Promise<Uint8Array> {
  const tier = getRarityTier(sale.rank, sale.totalSupply ?? 0);
  const art = safeArt(sale.imageUrl);
  const dateAbs = fullDate(sale.date);
  const ago = sale.date ? timeAgo(sale.date) : "";
  const hasColl = !!sale.collectionName;
  const hasUsd = sale.priceUsd != null && sale.priceUsd > 0;
  const hasDate = !!(dateAbs || sale.date);
  const chips = sale.traits.slice(0, 3);

  // EXACT height formula from the app canvas so the PNG dimensions match the in-app saved card.
  const H = Math.round(
    ART + 34 + 44 + (hasColl ? 28 : 0) + 16 + 26 + 92 + 34 + (hasUsd ? 34 : 0) + (hasDate ? 52 : 0) + (chips.length ? 48 : 0) + 8 + 30 + 28
  );

  const badgeText = `${tier.emoji} ${tier.rank ? "#" + tier.rank : "Unranked"}${tier.percentile != null ? " · " + tier.percentileLabel : ""}`;
  const dateLabel = `${dateAbs ?? "—"}${ago ? " · " + ago : ""}`;

  const element = (
    <div
      style={{
        display: "flex", flexDirection: "column", width: W, height: H, borderRadius: 28, overflow: "hidden",
        fontFamily: "Inter",
        backgroundImage: "linear-gradient(180deg, #10203a 0%, #0a1524 42%, #060d18 100%)",
      }}
    >
      <div style={{ display: "flex", position: "relative", width: W, height: ART, overflow: "hidden", backgroundColor: "#05080f" }}>
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" width={W} height={ART} style={{ width: W, height: ART, objectFit: "cover" }} />
        ) : (
          <div style={{ display: "flex", width: W, height: ART, alignItems: "center", justifyContent: "center", fontSize: 120, color: "rgba(255,224,106,0.3)" }}>{"◈"}</div>
        )}
        <div style={{ position: "absolute", top: 0, left: 0, width: W, height: 130, backgroundImage: "linear-gradient(180deg, rgba(3,7,14,0.7), rgba(3,7,14,0))" }} />
        <div
          style={{
            position: "absolute", top: 24, left: 24, display: "flex", alignItems: "center", height: 40, paddingLeft: 16, paddingRight: 16,
            borderRadius: 20, backgroundColor: "rgba(3,7,14,0.62)", border: `2px solid ${tier.accent}66`,
            color: tier.accent, fontSize: 22, fontWeight: 900,
          }}
        >
          {badgeText}
        </div>
        <div
          style={{
            position: "absolute", top: 26, left: 466, width: 340, height: 56, display: "flex",
            alignItems: "center", justifyContent: "center", transform: "rotate(45deg)", transformOrigin: "50% 50%",
            backgroundImage: "linear-gradient(180deg,#ffe577,#f0c000)", color: "#241200",
            fontSize: 30, fontWeight: 900, letterSpacing: 7,
          }}
        >
          SOLD
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: W, paddingTop: 30, paddingLeft: 40, paddingRight: 40 }}>
        <div style={{ display: "flex", maxWidth: W - 80, color: "#f4ecd6", fontSize: 34, fontWeight: 900, textAlign: "center", lineHeight: 1.1 }}>{sale.name}</div>
        {hasColl ? (
          <div style={{ display: "flex", marginTop: 6, color: "rgba(233,207,148,0.65)", fontSize: 17, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
            {sale.collectionName}
          </div>
        ) : null}

        <div style={{ display: "flex", marginTop: 16, color: "rgba(233,207,148,0.7)", fontSize: 15, fontWeight: 800, letterSpacing: 4 }}>SOLD FOR</div>
        <div style={{ display: "flex", marginTop: 6, color: "#ffe577", fontSize: 84, fontWeight: 900, lineHeight: 1 }}>{sale.priceXch.toFixed(2)}</div>
        <div style={{ display: "flex", marginTop: 8, color: "#e8cf94", fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>XCH</div>
        {hasUsd ? (
          <div style={{ display: "flex", marginTop: 8, color: "rgba(217,200,150,0.85)", fontSize: 22, fontWeight: 600 }}>
            {formatUsd(Math.round((sale.priceUsd as number) * 100) / 100)}
          </div>
        ) : null}

        {hasDate ? (
          <div style={{ display: "flex", marginTop: 12, height: 40, alignItems: "center", paddingLeft: 20, paddingRight: 20, borderRadius: 20, backgroundColor: "rgba(255,224,106,0.08)", border: "2px solid rgba(255,224,106,0.25)", color: "#e8cf94", fontSize: 19, fontWeight: 700 }}>
            {dateLabel}
          </div>
        ) : null}

        {chips.length > 0 ? (
          <div style={{ display: "flex", marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {chips.map((t, i) => (
              <div key={i} style={{ display: "flex", margin: 5, height: 32, alignItems: "center", paddingLeft: 12, paddingRight: 12, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", border: "2px solid rgba(255,224,106,0.18)", color: "#d9c896", fontSize: 17, fontWeight: 700 }}>
                {t.type}: {t.value}
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", marginTop: 16, color: "rgba(255,224,106,0.6)", fontSize: 17, fontWeight: 900, letterSpacing: 3 }}>{"◈ TRAITFOLIO"}</div>
      </div>
    </div>
  );

  const fonts = await loadFonts();
  const res = new ImageResponse(element, {
    width: W,
    height: H,
    emoji: "twemoji",
    ...(fonts.length ? { fonts } : {}),
  });
  return new Uint8Array(await res.arrayBuffer());
}
