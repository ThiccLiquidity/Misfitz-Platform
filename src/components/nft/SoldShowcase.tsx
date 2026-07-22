"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { formatUsd, formatXch, timeAgo } from "@/lib/format";
import { getRarityTier } from "@/lib/rarity/tiers";

// A shareable "SOLD" card. The on-screen card is the preview; "Save image" / "Copy image" rasterize a
// clean 2× PNG on a <canvas> so users never have to screenshot. The NFT art is pulled through Next's
// same-origin image optimizer (/_next/image) so the canvas is never CORS-tainted. The SOLD graphic is a
// corner ribbon (see .tf-sold-stamp) so it no longer covers the NFT itself.
export interface SoldShowcaseData {
  name: string;
  imageUrl: string | null;
  launcherId?: string | null;
  rank: number | null;
  totalSupply: number | null;
  priceXch: number;
  date: string | null;
  xchUsdRate?: number;
  traits?: { type: string; value: string }[];
  collectionName?: string | null;
}

function fullDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

// ── Canvas rasterizer ────────────────────────────────────────────────────────
function loadArt(url: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    // Same-origin optimizer proxy -> canvas stays untainted; falls back to placeholder on error.
    img.src = `/_next/image?url=${encodeURIComponent(url)}&w=640&q=80`;
  });
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, dw: number, dh: number) {
  const ir = img.width / img.height, r = dw / dh;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
}
function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
type Extra = { usd: number | null; dateAbs: string | null; chips: { type: string; value: string }[] };

function drawCard(sale: SoldShowcaseData, tier: ReturnType<typeof getRarityTier>, ex: Extra, art: HTMLImageElement | null): HTMLCanvasElement {
  const W = 720, A = 720, PX = 40;
  const hasColl = !!sale.collectionName, hasUsd = ex.usd != null, hasDate = !!(ex.dateAbs || sale.date), hasChips = ex.chips.length > 0;
  let H = A + 34 + 44 + (hasColl ? 28 : 0) + 16 + 26 + 92 + 34 + (hasUsd ? 34 : 0) + (hasDate ? 52 : 0) + (hasChips ? 48 : 0) + 8 + 30 + 28;

  const c = document.createElement("canvas");
  c.width = W; c.height = Math.round(H);
  const ctx = c.getContext("2d")!;
  const LS = (v: string) => { (ctx as unknown as { letterSpacing: string }).letterSpacing = v; };

  rr(ctx, 0, 0, W, H, 28); ctx.save(); ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#10203a"); bg.addColorStop(0.42, "#0a1524"); bg.addColorStop(1, "#060d18");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // art
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, A); ctx.clip();
  ctx.fillStyle = "#05080f"; ctx.fillRect(0, 0, W, A);
  if (art) cover(ctx, art, W, A);
  else { ctx.fillStyle = "rgba(255,224,106,0.3)"; ctx.font = "120px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("◈", W / 2, A / 2); }
  const tg = ctx.createLinearGradient(0, 0, 0, 130); tg.addColorStop(0, "rgba(3,7,14,0.7)"); tg.addColorStop(1, "rgba(3,7,14,0)");
  ctx.fillStyle = tg; ctx.fillRect(0, 0, W, 130);
  ctx.restore();

  // tier badge (top-left)
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = "900 22px system-ui,Segoe UI,sans-serif";
  const btxt = `${tier.emoji} ${tier.rank ? "#" + tier.rank : "Unranked"}${tier.percentile != null ? " · " + tier.percentileLabel : ""}`;
  const bw = ctx.measureText(btxt).width + 32, bh = 40, bx = 24, by = 24;
  rr(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = "rgba(3,7,14,0.62)"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = tier.accent + "66"; ctx.stroke();
  ctx.fillStyle = tier.accent; ctx.fillText(btxt, bx + 16, by + bh / 2 + 1);

  // SOLD corner ribbon (top-right)
  ctx.save(); ctx.translate(W - 84, 54); ctx.rotate(Math.PI / 4);
  const rg = ctx.createLinearGradient(0, -28, 0, 28); rg.addColorStop(0, "#ffe577"); rg.addColorStop(1, "#f0c000");
  ctx.fillStyle = rg; ctx.fillRect(-170, -28, 340, 56);
  ctx.fillStyle = "#241200"; ctx.font = "900 32px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; LS("7px");
  ctx.fillText("SOLD", 0, 1); LS("0px");
  ctx.restore();

  // ── text flow ──
  let y = A + 34; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = "#f4ecd6"; ctx.font = "900 34px system-ui,Segoe UI,sans-serif";
  ctx.fillText(truncate(ctx, sale.name, W - PX * 2), W / 2, y); y += 44;
  if (hasColl) { ctx.fillStyle = "rgba(233,207,148,0.65)"; ctx.font = "700 17px system-ui,sans-serif"; LS("1.5px"); ctx.fillText(truncate(ctx, (sale.collectionName || "").toUpperCase(), W - PX * 2), W / 2, y); LS("0px"); y += 28; }
  y += 16;
  ctx.fillStyle = "rgba(233,207,148,0.7)"; ctx.font = "800 15px system-ui,sans-serif"; LS("4px"); ctx.fillText("SOLD FOR", W / 2, y); LS("0px"); y += 26;
  ctx.fillStyle = "#ffe577"; ctx.font = "900 84px system-ui,Segoe UI,sans-serif"; ctx.fillText(sale.priceXch.toFixed(2), W / 2, y); y += 92;
  ctx.fillStyle = "#e8cf94"; ctx.font = "900 22px system-ui,sans-serif"; LS("2px"); ctx.fillText("XCH", W / 2, y); LS("0px"); y += 34;
  if (hasUsd) { ctx.fillStyle = "rgba(217,200,150,0.85)"; ctx.font = "600 22px system-ui,sans-serif"; ctx.fillText(formatUsd(Math.round((ex.usd as number) * 100) / 100), W / 2, y); y += 34; }
  if (hasDate) {
    const label = `${ex.dateAbs ?? "—"}${sale.date ? " · " + timeAgo(sale.date) : ""}`;
    ctx.font = "700 19px system-ui,sans-serif"; ctx.textBaseline = "middle";
    const pw = ctx.measureText(label).width + 40, ph = 40, px = (W - pw) / 2;
    rr(ctx, px, y, pw, ph, ph / 2); ctx.fillStyle = "rgba(255,224,106,0.08)"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,224,106,0.25)"; ctx.stroke();
    ctx.fillStyle = "#e8cf94"; ctx.fillText(label, W / 2, y + ph / 2 + 1); ctx.textBaseline = "top"; y += 52;
  }
  if (hasChips) {
    ctx.font = "700 17px system-ui,sans-serif"; ctx.textBaseline = "middle";
    const labels = ex.chips.map((t) => `${t.type}: ${t.value}`);
    const ws = labels.map((l) => ctx.measureText(l).width + 24);
    const total = ws.reduce((a, b) => a + b, 0) + 10 * (ex.chips.length - 1);
    let cx = (W - total) / 2, chH = 32;
    for (let i = 0; i < ex.chips.length; i++) {
      rr(ctx, cx, y, ws[i], chH, 8); ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,224,106,0.18)"; ctx.stroke();
      ctx.fillStyle = "#d9c896"; ctx.fillText(labels[i], cx + ws[i] / 2, y + chH / 2 + 1); cx += ws[i] + 10;
    }
    ctx.textBaseline = "top"; y += 48;
  }
  y += 8; ctx.fillStyle = "rgba(255,224,106,0.6)"; ctx.font = "900 17px system-ui,sans-serif"; LS("3px"); ctx.fillText("◈ TRAITFOLIO", W / 2, y); LS("0px");
  ctx.restore();
  return c;
}

const sanitize = (s: string) => s.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "nft";

export function SoldShowcase({ sale, onClose }: { sale: SoldShowcaseData; onClose: () => void }) {
  const [busy, setBusy] = useState<null | "save" | "copy">(null);
  const [done, setDone] = useState<null | "save" | "copy">(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const tier = getRarityTier(sale.rank, sale.totalSupply ?? 0);
  const saleAgeDays = sale.date ? (Date.now() - Date.parse(sale.date)) / 86_400_000 : Infinity;
  const usdFresh = Number.isFinite(saleAgeDays) && saleAgeDays <= 7;
  const usd = usdFresh && sale.xchUsdRate && sale.xchUsdRate > 0 ? sale.priceXch * sale.xchUsdRate : null;
  const dateAbs = fullDate(sale.date);
  const chips = (sale.traits ?? []).slice(0, 3);

  // One-click share to the user's OWN X account: opens X's compose window pre-filled with a caption + a link
  // to a share page whose OG image IS this exact SOLD card, so X unfurls the branded card. No login/OAuth on
  // our side (stays no-login) — the user just hits Post. The Save/Copy buttons remain for the full-res image.
  const shareToX = () => {
    // CLEAN share link: just /s/<launcherId>. The share page fetches the sale server-side from that id and
    // emits OG/Twitter-card metadata whose image IS this SOLD card, so X unfurls the branded card — no giant
    // query string in the tweet. Caption stays short (name + price + rank). No OAuth: user hits Post themself.
    const text = `${sale.name} sold for ${formatXch(sale.priceXch)}${tier.rank ? ` \u00b7 Rank #${tier.rank}` : ""} on Traitfolio \u25c8`;
    const params = new URLSearchParams({ text });
    if (sale.launcherId) params.set("url", `${window.location.origin}/s/${sale.launcherId}`);
    const intent = `https://x.com/intent/post?${params.toString()}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  };

  const render = async (): Promise<Blob | null> => {
    const art = await loadArt(sale.imageUrl);
    const canvas = drawCard(sale, tier, { usd, dateAbs, chips }, art);
    return await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
  };
  const saveImage = async () => {
    setBusy("save");
    try {
      const blob = await render();
      if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${sanitize(sale.name)}-sold.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        setDone("save"); setTimeout(() => setDone(null), 1600);
      }
    } catch { /* ignore */ } finally { setBusy(null); }
  };
  const copyImage = async () => {
    setBusy("copy");
    try {
      const blob = await render();
      const cb = navigator.clipboard as Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> };
      if (blob && typeof ClipboardItem !== "undefined" && cb.write) {
        await cb.write([new ClipboardItem({ "image/png": blob })]);
        setDone("copy"); setTimeout(() => setDone(null), 1600);
      } else if (blob) {
        // Clipboard image unsupported here — fall back to a download so the user still gets the file.
        await saveImage();
      }
    } catch { /* ignore */ } finally { setBusy(null); }
  };

  const btn = "rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 py-8"
      style={{ background: "rgba(3,7,14,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${sale.name} sold for ${formatXch(sale.priceXch)} XCH`}
    >
      <div className="m-auto flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <div
          id="tf-sold-card"
          data-theme="dark"
          className="relative w-full overflow-hidden rounded-2xl"
          style={{
            maxWidth: 360,
            background: "radial-gradient(120% 90% at 50% 0%, #10203a 0%, #0a1524 55%, #060d18 100%)",
            border: "1px solid rgba(255,224,106,0.28)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 0 60px rgba(255,224,106,0.05)",
          }}
        >
          <div className="relative aspect-square w-full overflow-hidden" style={{ background: "#05080f" }}>
            {sale.imageUrl ? (
              <Image src={sale.imageUrl} alt={sale.name} fill className="object-cover" sizes="360px" unoptimized priority />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl" style={{ color: "rgba(255,224,106,0.3)" }}>◈</div>
            )}
            <div className="tf-sold-stamp" aria-hidden>SOLD</div>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-16" style={{ background: "linear-gradient(180deg, rgba(3,7,14,0.7), transparent)" }} />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black"
              style={{ background: "rgba(3,7,14,0.6)", border: `1px solid ${tier.accent}66`, color: tier.accent }}>
              <span>{tier.emoji}</span>
              <span>{tier.rank ? `#${tier.rank}` : "Unranked"}</span>
              {tier.percentile != null && <span style={{ opacity: 0.85 }}>· {tier.percentileLabel}</span>}
            </div>
          </div>

          <div className="px-5 pb-5 pt-4 text-center">
            <div className="truncate text-lg font-black" style={{ color: "#f4ecd6" }}>{sale.name}</div>
            {sale.collectionName && (
              <div className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(233,207,148,0.65)" }}>{sale.collectionName}</div>
            )}

            <div className="mt-3.5 mb-1 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(233,207,148,0.7)" }}>Sold for</div>
            <div className="tf-foil text-5xl font-black leading-none tabular-nums">{sale.priceXch.toFixed(2)}</div>
            <div className="mt-1 text-sm font-black tracking-wide" style={{ color: "#e8cf94" }}>XCH</div>
            {usd != null && <div className="mt-1 text-sm font-semibold tabular-nums" style={{ color: "rgba(217,200,150,0.85)" }}>{formatUsd(Math.round(usd * 100) / 100)}</div>}

            {(dateAbs || sale.date) && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ background: "rgba(255,224,106,0.07)", border: "1px solid rgba(255,224,106,0.2)", color: "#e8cf94" }}>
                <span>{dateAbs ?? "—"}</span>
                {sale.date && <span style={{ opacity: 0.6 }}>· {timeAgo(sale.date)}</span>}
              </div>
            )}

            {chips.length > 0 && (
              <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
                {chips.map((t, i) => (
                  <span key={i} className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,224,106,0.18)", color: "#d9c896" }}>
                    <span style={{ opacity: 0.65 }}>{t.type}:</span> {t.value}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: "rgba(255,224,106,0.5)" }}>
              <span style={{ color: "var(--gold)" }}>◈</span> Traitfolio
            </div>
          </div>
        </div>

        {/* ── Chrome (outside the frame) ── */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={shareToX} className={btn}
            style={{ background: "#000", border: "1px solid rgba(255,255,255,0.3)", color: "#fff" }}>
            Share to X
          </button>
          <button type="button" onClick={saveImage} disabled={busy !== null} className={btn}
            style={{ background: "linear-gradient(180deg,#ffe577,#e8b800)", border: "1px solid rgba(150,110,0,0.55)", color: "#241200" }}>
            {busy === "save" ? "Saving…" : done === "save" ? "Saved ✓" : "Save image"}
          </button>
          <button type="button" onClick={copyImage} disabled={busy !== null} className={btn}
            style={{ background: "rgba(255,224,106,0.12)", border: "1px solid rgba(255,224,106,0.35)", color: "var(--gold)" }}>
            {busy === "copy" ? "Copying…" : done === "copy" ? "Copied ✓" : "Copy image"}
          </button>
          <button type="button" onClick={onClose} className={btn}
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#e6e6e6" }}>
            Close
          </button>
        </div>
        <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Save or copy the card as an image to share the sale</div>
      </div>
    </div>
  );
}
