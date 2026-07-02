/**
 * Historical backtest for the Traitfolio valuation model — the launch gate.
 *
 * Leave-future-out: for every past clean XCH sale, rebuild the comps model from ONLY the sales that
 * happened strictly BEFORE it, estimate the NFT's value at that moment, and compare to the actual sale
 * price. Reports error (median headline + mean), SIGNED bias, hit-rates, breakdowns by confidence tier
 * and rarity band, and the [0.2x,5x] clamp clip-rate with examples. Pools across collections (the
 * trustworthy number) with per-collection diagnostics.
 *
 *   npx tsx scripts/backtest-valuation.ts col1<id> [col1<id> ...] [--max=800] [--since=YYYY-MM-DD] [--clips=8]
 *
 * --since=DATE  evaluate only sales on/after DATE (training still uses all prior sales). Use this to
 *               re-validate on a HELD-OUT time slice after any parameter change, so tuning can't
 *               contaminate the validation.
 *
 * IMPORTANT: do NOT tune parameters against these results. Report first. (See footer.)
 *
 * Self-contained: direct MintGarden + Dexie public APIs + PURE model functions (no DB/alias chain).
 * Simplifications (documented): current collection floor as the anchor for every historical point;
 * sales sourced from MintGarden per-NFT events (type 2, XCH-only); rank = MintGarden openrarity_rank
 * when present, else our own information-content ranking (sorted, scaled to supply), mirroring production.
 */
import { buildCompsModel, type Sale } from "../src/lib/valuation/comps";
import { rarityFactorForPercentile } from "../src/lib/valuation/estimate";
import { buildRankEstimator, type FrequencyCounts } from "../src/lib/rarity/estimateRank";

const MG = "https://api.mintgarden.io";
const DEXIE = "https://api.dexie.space/v1";
const args = process.argv.slice(2);
const cols = args.filter((a) => a.startsWith("col1"));
const flag = (name: string, def: string) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${def}`).split("=")[1];
const MAX = Number(flag("max", "800"));
const SINCE = flag("since", "");
const SINCE_MS = SINCE ? new Date(SINCE).getTime() : 0;
const N_CLIP_EXAMPLES = Number(flag("clips", "8"));
if (cols.length === 0) { console.error("usage: tsx scripts/backtest-valuation.ts col1<id> [col1<id> ...] [--max=N] [--since=YYYY-MM-DD] [--clips=K]"); process.exit(1); }

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const spct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "n/a");

// Inline tier thresholds (cumulative percentile) so the script stays dependency-free.
const TIERS: [string, number][] = [["mythic", 0.1], ["legendary", 0.5], ["epic", 2.5], ["rare", 10], ["uncommon", 30], ["common", 100]];
const bandOf = (p: number) => TIERS.find(([, t]) => p <= t)?.[0] ?? "common";
const confTier = (c: number) => (c >= 0.66 ? "High" : c >= 0.4 ? "Medium" : "Low");

type Ev = { type?: number | null; xch_price?: number | null; timestamp?: string;
  address?: { encoded_id?: string | null } | null; previous_address?: { encoded_id?: string | null } | null;
  payments?: { asset_id?: string | null }[] | null };
type Detail = { openrarity_rank?: number | string | null; events?: Ev[] | null;
  data?: { metadata_json?: { attributes?: { trait_type?: string; type?: string; name?: string; value?: unknown }[] } };
  collection?: { nft_count?: number; attributes_frequency_counts?: FrequencyCounts | null } };
type Row = Sale & { id: string; date: number };
type Rec = { col: string; band: string; conf: string; abs: number; signed: number; clipped: boolean; rank: number; price: number; baseline: number };

const traitsOf = (d: Detail) =>
  (d.data?.metadata_json?.attributes ?? [])
    .map((a) => ({ k: String(a.trait_type ?? a.type ?? a.name ?? ""), v: String(a.value ?? "") }))
    .filter((t) => t.k && t.v && !/^rarity rank$/i.test(t.k));

async function gather(colId: string) {
  let floor = 0;
  try {
    const off = await j<{ offers?: { price?: number; requested?: { id?: string }[] }[] }>(`${DEXIE}/offers?status=0&offered=${colId}&requested=xch&sort=price_asc&page_size=20`);
    for (const o of off.offers ?? []) { const req = o.requested ?? []; if (req.length === 1 && (req[0].id ?? "").toLowerCase() === "xch" && (o.price ?? 0) > 0) { floor = o.price!; break; } }
  } catch { /* */ }
  const ids: string[] = []; let cursor: string | null = null;
  do {
    const pr: { items?: { encoded_id?: string }[]; next?: string | null } = await j(`${MG}/collections/${colId}/nfts?size=100${cursor ? `&page=${encodeURIComponent(cursor)}` : ""}`);
    for (const it of pr.items ?? []) if (it.encoded_id && ids.length < MAX) ids.push(it.encoded_id);
    cursor = pr.next ?? null;
  } while (cursor && ids.length < MAX);
  const details: Detail[] = new Array(ids.length); let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < ids.length) { const k = i++; try { details[k] = await j<Detail>(`${MG}/nfts/${ids[k]}`); } catch { /* */ } } }));
  let supply = 0; let freq: FrequencyCounts | undefined; const perNft: { id: string; traits: { k: string; v: string }[] }[] = []; const raw: Row[] = [];
  details.forEach((d, k) => {
    if (!d) return;
    if ((d.collection?.nft_count ?? 0) > supply) supply = d.collection!.nft_count!;
    if (!freq && d.collection?.attributes_frequency_counts) freq = d.collection.attributes_frequency_counts!;
    const traits = traitsOf(d); perNft.push({ id: ids[k], traits });
    const rk = Number(d.openrarity_rank); const mgRank = Number.isFinite(rk) && rk > 0 ? rk : null;
    for (const e of d.events ?? []) {
      if (e.type !== 2 || !((e.xch_price ?? 0) > 0) || (e.payments ?? []).some((p) => p.asset_id)) continue;
      raw.push({ id: ids[k], rank: mgRank ?? 0, price: e.xch_price!, ageDays: 0, traits, seller: e.previous_address?.encoded_id ?? undefined, buyer: e.address?.encoded_id ?? undefined, date: e.timestamp ? new Date(e.timestamp).getTime() : 0 });
    }
  });
  if (supply <= 0) supply = perNft.length;
  const anyMg = raw.some((s) => s.rank > 0);
  if (!anyMg && freq) {
    const est = buildRankEstimator(freq, perNft.length);
    if (est) {
      const scored = perNft.map((n) => ({ id: n.id, score: est.scoreOf(n.traits.map((t) => ({ trait_type: t.k, value: t.v }))) })).sort((a, b) => b.score - a.score);
      const M = scored.length; const rankById = new Map<string, number>();
      scored.forEach((e, idx) => rankById.set(e.id, Math.max(1, Math.min(supply, Math.round(((idx + 0.5) / M) * supply)))));
      for (const s of raw) s.rank = rankById.get(s.id) ?? 0;
    }
  }
  const sales = raw.filter((s) => s.rank > 0 && s.date > 0).sort((a, b) => a.date - b.date);
  return { floor, supply, freq, sales, ranked: anyMg ? "MintGarden" : "own IC", dates: sales.map((s) => s.date) };
}

async function main() {
  const WARMUP = 8;
  const all: Rec[] = []; const perCol: Record<string, Rec[]> = {}; let minDate = Infinity, maxDate = 0; let totalSales = 0;
  for (const colId of cols) {
    process.stderr.write(`gathering ${colId} …\n`);
    const g = await gather(colId).catch((e) => { console.error(`  ${colId}: ${e.message}`); return null; });
    if (!g) continue;
    if (g.floor <= 0) { console.error(`  ${colId}: no Dexie floor — skipped (can't anchor).`); continue; }
    totalSales += g.sales.length;
    for (const d of g.dates) { if (d) { minDate = Math.min(minDate, d); maxDate = Math.max(maxDate, d); } }
    perCol[colId] = [];
    for (let n = 0; n < g.sales.length; n++) {
      const s = g.sales[n];
      const p = (s.rank / g.supply) * 100;
      const baseline = g.floor * (1 + rarityFactorForPercentile(p));
      const clipped = s.price < 0.2 * baseline || s.price > 5 * baseline;
      if (n < WARMUP) continue;
      if (SINCE_MS && s.date < SINCE_MS) continue; // held-out slice: eval only sales on/after --since
      const prior = g.sales.slice(0, n).map((x) => ({ rank: x.rank, price: x.price, traits: x.traits, seller: x.seller, buyer: x.buyer, ageDays: Math.max(0, (s.date - x.date) / 86_400_000) } as Sale));
      const model = buildCompsModel(prior, g.supply, { floor: g.floor, rarityFactor: rarityFactorForPercentile, traitFreq: g.freq });
      if (!model) continue;
      const cv = model.valueOf(s.rank, s.traits); const est = cv.value ?? model.curveValue(s.rank);
      if (!(est > 0)) continue;
      const rec: Rec = { col: colId, band: bandOf(p), conf: confTier(cv.confidence), abs: Math.abs(est - s.price) / s.price, signed: (est - s.price) / s.price, clipped, rank: s.rank, price: s.price, baseline };
      all.push(rec); perCol[colId].push(rec);
    }
  }

  const grp = (recs: Rec[], key: (r: Rec) => string, order?: string[]) => {
    const m = new Map<string, Rec[]>(); for (const r of recs) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    const keys = order ? order.filter((k) => m.has(k)) : [...m.keys()];
    return keys.map((k) => { const v = m.get(k)!; return { k, n: v.length, medAbs: median(v.map((r) => r.abs)), medSigned: median(v.map((r) => r.signed)) }; });
  };
  const clipRecs = all.length ? all : []; // clip stats computed over ALL sales (incl. warmup) below

  console.log("\n================ TRAITFOLIO VALUATION BACKTEST ================");
  console.log(`collections:      ${cols.length}   evaluated sales: ${all.length}   (raw clean sales: ${totalSales})`);
  console.log(`date range:       ${minDate < Infinity ? new Date(minDate).toISOString().slice(0, 10) : "n/a"} → ${maxDate ? new Date(maxDate).toISOString().slice(0, 10) : "n/a"}${SINCE ? `   (eval slice: on/after ${SINCE})` : ""}`);
  console.log(`method:           leave-future-out (each sale estimated from ONLY sales strictly before it); warmup=${WARMUP}; anchor=current Dexie floor`);
  if (!all.length) { console.log("\nNo evaluable sales. (Thin history, no floor, or --since too recent.)"); return; }

  console.log("\n── Error (pooled — the trustworthy number) ──");
  console.log(`  median abs % error (HEADLINE): ${pct(median(all.map((r) => r.abs)))}`);
  console.log(`  mean abs % error:              ${pct(mean(all.map((r) => r.abs)))}   (gap to median = tail influence)`);
  console.log(`  within ±25% / ±50%:            ${pct(all.filter((r) => r.abs <= 0.25).length / all.length)} / ${pct(all.filter((r) => r.abs <= 0.5).length / all.length)}`);
  console.log("\n── Signed bias (+ = model OVERestimates) ──");
  console.log(`  median signed % error:         ${spct(median(all.map((r) => r.signed)))}`);
  console.log(`  mean signed % error:           ${spct(mean(all.map((r) => r.signed)))}`);

  console.log("\n── By confidence tier ──   (Low/mythic error is expected; High-confidence error is not)");
  for (const r of grp(all, (x) => x.conf, ["High", "Medium", "Low"])) console.log(`  ${r.k.padEnd(7)} n=${String(r.n).padStart(4)}  medAbs ${pct(r.medAbs).padStart(7)}  medSigned ${spct(r.medSigned).padStart(7)}`);
  console.log("\n── By rarity band ──");
  for (const r of grp(all, (x) => x.band, TIERS.map(([t]) => t))) console.log(`  ${r.k.padEnd(10)} n=${String(r.n).padStart(4)}  medAbs ${pct(r.medAbs).padStart(7)}  medSigned ${spct(r.medSigned).padStart(7)}`);

  // Clamp clip-rate over ALL clean sales (independent of warmup/eval slice) + examples.
  const clipAll: { col: string; clipped: boolean; rank: number; price: number; baseline: number }[] = [];
  for (const [c, recs] of Object.entries(perCol)) for (const r of recs) clipAll.push({ col: c, clipped: r.clipped, rank: r.rank, price: r.price, baseline: r.baseline });
  const clips = clipAll.filter((r) => r.clipped);
  console.log("\n── [0.2×, 5×] baseline clamp ──");
  console.log(`  clip-rate: ${clipAll.length ? pct(clips.length / clipAll.length) : "n/a"} (${clips.length}/${clipAll.length})   ${clipAll.length && clips.length / clipAll.length > 0.05 ? "⚠ >5% — 5× may be too tight; eyeball below" : "(healthy if these are outliers/wash)"}`);
  for (const ex of clips.slice(0, N_CLIP_EXAMPLES)) console.log(`    rank ${String(ex.rank).padStart(5)}  price ${ex.price.toFixed(2)}  baseline ${ex.baseline.toFixed(2)}  ratio ${(ex.price / ex.baseline).toFixed(1)}×  [${ex.col.slice(0, 10)}…]`);

  console.log("\n── Per-collection (diagnostic only — do NOT tune to any single one) ──");
  for (const [c, recs] of Object.entries(perCol)) console.log(`  ${c.slice(0, 12)}…  n=${String(recs.length).padStart(4)}  medAbs ${pct(median(recs.map((r) => r.abs))).padStart(7)}  medSigned ${spct(median(recs.map((r) => r.signed))).padStart(7)}`);

  console.log("\n⚠ Do NOT tune parameters against these results — report first. If tuning is needed, re-validate");
  console.log("  on a fresh held-out slice: --since=<a date AFTER the sales you looked at>.");
  console.log("==============================================================\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
