#!/usr/bin/env node
// Comparable-sales valuation PROTOTYPE (read-only). Pulls real clean-XCH sales for a collection,
// joins each sale to its rank + traits, and builds the "everything works off itself" model:
//
//   1. floor            — hard bottom anchor (cheapest clean active XCH ask)
//   2. rank→price curve — k-nearest-by-rank median of real sales ("similar rarity within a tier"),
//                         so value flows continuously up/down the collection, sold or not
//   3. trait premiums   — for each trait value, median(sale / rank-curve expectation): how much that
//                         specific trait beats (or drags) what rarity alone predicts
//   4. composite        — value = rankCurve(rank) × Π(shrunk trait multipliers), floored
//   5. fallback         — where comps are too thin, shrink toward floor (the old prior fills the gap)
//
// Confidence (sale counts) rides along so we can see measured vs guessed. Nothing is written anywhere.
//
// Usage:  node scripts/comps-report.mjs [colId] [--max-nfts=400] [--half-life-days=120]
// Default colId = ChiaPhunks.

const MG = "https://api.mintgarden.io";
const DEXIE = "https://api.dexie.space/v1";

const args = process.argv.slice(2);
const colId = args.find((a) => a.startsWith("col1")) || "col13y2d52ewkfp7hfa4eq22fme7enh95c9t37fnumfx9lcjye5cpy4q9t4jep";
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : d; };
const MAX_NFTS = opt("max-nfts", 400);   // cap on sold-NFT detail fetches (bounds runtime)
const HALF_LIFE = opt("half-life-days", 120);
const SALE_PAGES = opt("sale-pages", 30); // Dexie completed-sale pages to scan (100/page)
const CONC = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(300 * (i + 1));
  }
  return null;
}
// Simple concurrency pool.
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ── 1. Floor: cheapest clean single-NFT XCH ask (requested=xch makes Dexie honor price_asc) ──────
async function fetchFloor() {
  const j = await getJSON(`${DEXIE}/offers?status=0&offered=${colId}&requested=xch&sort=price_asc&page_size=20`);
  for (const o of j?.offers ?? []) {
    const req = o.requested ?? [];
    const xchOnly = req.length === 1 && (req[0].id ?? "").toLowerCase() === "xch";
    const single = (o.offered ?? []).filter((x) => x.is_nft).length === 1;
    if (xchOnly && single && typeof o.price === "number" && o.price > 0) return o.price;
  }
  return null;
}

// ── 2. Sales: completed clean-XCH offers (status=4). Keep most-recent sale per NFT. ──────────────
async function fetchSales() {
  const byNft = new Map(); // hex id -> { price, date }
  for (let page = 1; page <= SALE_PAGES; page++) {
    const j = await getJSON(`${DEXIE}/offers?status=4&offered=${colId}&requested=xch&sort=date_completed&page=${page}&page_size=100`);
    const offers = j?.offers ?? [];
    if (!offers.length) break;
    for (const o of offers) {
      const req = o.requested ?? [];
      const xchOnly = req.length === 1 && (req[0].id ?? "").toLowerCase() === "xch";
      const nfts = (o.offered ?? []).filter((x) => x.is_nft && x.id);
      if (!xchOnly || nfts.length !== 1 || typeof o.price !== "number" || o.price <= 0) continue;
      const id = nfts[0].id;
      const date = o.date_completed || o.date_found;
      if (!byNft.has(id)) byNft.set(id, { price: o.price, date });
    }
    if (offers.length < 100) break;
  }
  return byNft; // most-recent sale per NFT (sorted desc, first seen wins)
}

// ── Join: fetch rank + traits for each sold NFT (capped, most-recent first). ─────────────────────
async function enrichSales(byNft) {
  const entries = [...byNft.entries()]
    .sort((a, b) => new Date(b[1].date) - new Date(a[1].date))
    .slice(0, MAX_NFTS);
  const now = Date.now();
  const recs = await pool(entries, CONC, async ([id, sale]) => {
    const d = await getJSON(`${MG}/nfts/${id}`);
    if (!d) return null;
    const rank = Number(d.openrarity_rank);
    const traits = (d.data?.metadata_json?.attributes ?? [])
      .filter((a) => a && a.trait_type != null && a.value != null)
      .map((a) => ({ k: String(a.trait_type), v: String(a.value) }));
    if (!Number.isFinite(rank)) return null;
    const ageDays = (now - new Date(sale.date).getTime()) / 86400000;
    const weight = Math.pow(0.5, ageDays / HALF_LIFE); // recency decay
    return { id, price: sale.price, date: sale.date, rank, traits, ageDays, weight };
  });
  return recs.filter(Boolean);
}

// ── 3. Rank curve: k-nearest-by-rank weighted median of sale prices. ─────────────────────────────
function makeRankCurve(recs, K = 25) {
  const sorted = [...recs].sort((a, b) => a.rank - b.rank);
  return (rank) => {
    if (!sorted.length) return null;
    // nearest K by |rank distance|
    const near = [...sorted].sort((a, b) => Math.abs(a.rank - rank) - Math.abs(b.rank - rank)).slice(0, K);
    return median(near.map((r) => r.price));
  };
}

// ── 4. Trait premiums: median(sale / rank-curve) per trait value, shrunk by sample count. ────────
function traitPremiums(recs, curve, kShrink = 8) {
  const buckets = new Map(); // "k=v" -> ratios[]
  for (const r of recs) {
    const base = curve(r.rank);
    if (!base || base <= 0) continue;
    for (const t of r.traits) {
      const key = `${t.k} = ${t.v}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r.price / base);
    }
  }
  const out = [];
  for (const [key, ratios] of buckets) {
    const m = median(ratios);
    const n = ratios.length;
    const shrunk = 1 + (m - 1) * (n / (n + kShrink)); // toward 1.0 when thin
    out.push({ key, mult: m, shrunk, n });
  }
  return out.sort((a, b) => b.shrunk - a.shrunk);
}

(async () => {
  console.log(`\nComparable-sales prototype — collection ${colId}\n`);
  const [floor, byNft] = await Promise.all([fetchFloor(), fetchSales()]);
  console.log(`Floor (clean XCH ask):        ${floor ?? "n/a"} XCH`);
  console.log(`Distinct NFTs with a clean-XCH sale (recent scan): ${byNft.size}`);

  const recs = await enrichSales(byNft);
  console.log(`Sales joined to rank+traits:  ${recs.length} (cap ${MAX_NFTS})\n`);
  if (!recs.length) { console.log("No comps — would fall back entirely to floor+premium prior."); return; }

  const prices = recs.map((r) => r.price);
  console.log(`Sale price  min / median / max:  ${median(prices) && Math.min(...prices)} / ${median(prices)} / ${Math.max(...prices)} XCH`);

  const curve = makeRankCurve(recs);
  console.log(`\nRank→price curve (k-NN median of real sales):`);
  for (const r of [1, 100, 500, 1000, 2500, 5000, 7500, 9985]) {
    const v = curve(r);
    console.log(`  rank ${String(r).padStart(5)}:  ${v != null ? v.toFixed(2) + " XCH" : "n/a"}`);
  }

  const prem = traitPremiums(recs, curve);
  const show = (arr, label) => {
    console.log(`\n${label}`);
    for (const p of arr) console.log(`  ${p.shrunk.toFixed(2)}x  (raw ${p.mult.toFixed(2)}x, n=${p.n})  ${p.key}`);
  };
  show(prem.filter((p) => p.n >= 3).slice(0, 12), "Top trait premiums (sales beat rank expectation):");
  show(prem.filter((p) => p.n >= 3).slice(-8).reverse(), "Biggest trait drags (sell below rank expectation):");

  // Spotlight the Body trait — ChiaPhunks' headline value axis.
  const body = prem.filter((p) => p.key.startsWith("Body =")).sort((a, b) => b.shrunk - a.shrunk);
  show(body, "Body trait (headline axis):");

  console.log(`\nDone. This is read-only analysis — nothing was written or traded.\n`);
})();
