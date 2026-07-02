/**
 * Historical backtest for the Traitfolio valuation model — the launch gate.
 *
 * For every past clean XCH sale in a collection, it rebuilds the comps model from ONLY the sales that
 * happened BEFORE that sale (leave-future-out), estimates the NFT's value at that moment, and compares
 * it to what it actually sold for. It also reports how many real sales the [0.2x, 5x] baseline clamp
 * would have clipped — so we can validate the clamp bounds against reality, not reasoning.
 *
 * Self-contained: talks to the MintGarden + Dexie public APIs directly and uses only the PURE model
 * functions (no DB/cache/alias chain), so it runs anywhere with Node 18+ and network.
 *
 *   npx tsx scripts/backtest-valuation.ts col1<collectionId> [--max=800]
 *
 * Simplifications (documented, acceptable for a calibration gate): uses the CURRENT collection floor as
 * the anchor for every historical point (we don't have per-day floors), and sources sales from
 * MintGarden's per-NFT event history (type 2, XCH-only). Rank uses MintGarden's openrarity_rank when
 * present, else our own information-content ranking (sorted, scaled to supply) — mirroring production.
 */
import { buildCompsModel, type Sale } from "../src/lib/valuation/comps";
import { rarityFactorForPercentile } from "../src/lib/valuation/estimate";
import { buildRankEstimator, type FrequencyCounts } from "../src/lib/rarity/estimateRank";

const MG = "https://api.mintgarden.io";
const DEXIE = "https://api.dexie.space/v1";
const arg = process.argv[2];
const MAX = Number((process.argv.find((a) => a.startsWith("--max=")) ?? "--max=800").split("=")[1]);
if (!arg || !arg.startsWith("col1")) { console.error("usage: tsx scripts/backtest-valuation.ts col1<id> [--max=N]"); process.exit(1); }

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

type Ev = { type?: number | null; xch_price?: number | null; timestamp?: string;
  address?: { encoded_id?: string | null } | null; previous_address?: { encoded_id?: string | null } | null;
  payments?: { asset_id?: string | null }[] | null };
type Detail = { openrarity_rank?: number | string | null; events?: Ev[] | null;
  data?: { metadata_json?: { attributes?: { trait_type?: string; type?: string; name?: string; value?: unknown }[] } };
  collection?: { nft_count?: number; attributes_frequency_counts?: FrequencyCounts | null } };

const traitsOf = (d: Detail) =>
  (d.data?.metadata_json?.attributes ?? [])
    .map((a) => ({ k: String(a.trait_type ?? a.type ?? a.name ?? ""), v: String(a.value ?? "") }))
    .filter((t) => t.k && t.v && !/^rarity rank$/i.test(t.k));

async function main() {
  console.log(`Backtesting ${arg} …`);
  // Floor (anchor).
  let floor = 0;
  try {
    const off = await j<{ offers?: { price?: number; requested?: { id?: string }[] }[] }>(
      `${DEXIE}/offers?status=0&offered=${arg}&requested=xch&sort=price_asc&page_size=20`);
    for (const o of off.offers ?? []) { const req = o.requested ?? [];
      if (req.length === 1 && (req[0].id ?? "").toLowerCase() === "xch" && (o.price ?? 0) > 0) { floor = o.price!; break; } }
  } catch { /* ignore */ }
  if (floor <= 0) { console.error("No Dexie floor found — cannot anchor the model. Aborting."); process.exit(1); }

  // Page collection NFTs.
  const ids: string[] = []; let cursor: string | null = null;
  do {
    const pageRes: { items?: { encoded_id?: string }[]; next?: string | null } =
      await j(`${MG}/collections/${arg}/nfts?size=100${cursor ? `&page=${encodeURIComponent(cursor)}` : ""}`);
    for (const it of pageRes.items ?? []) { if (it.encoded_id && ids.length < MAX) ids.push(it.encoded_id); }
    cursor = pageRes.next ?? null;
  } while (cursor && ids.length < MAX);
  console.log(`  ${ids.length} NFTs; fetching details…`);

  // Fetch details (bounded concurrency), gather sales + traits + freq.
  const details: Detail[] = new Array(ids.length);
  let i = 0; const CONC = 8;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < ids.length) { const k = i++; try { details[k] = await j<Detail>(`${MG}/nfts/${ids[k]}`); } catch { /* skip */ } }
  }));

  let supply = 0; let freq: FrequencyCounts | undefined; const perNft: { id: string; traits: { k: string; v: string }[] }[] = [];
  type Row = Sale & { date: number };
  const salesRaw: (Row & { id: string })[] = [];
  details.forEach((d, k) => {
    if (!d) return;
    if ((d.collection?.nft_count ?? 0) > supply) supply = d.collection!.nft_count!;
    if (!freq && d.collection?.attributes_frequency_counts) freq = d.collection.attributes_frequency_counts!;
    const traits = traitsOf(d);
    perNft.push({ id: ids[k], traits });
    const rankMg = Number(d.openrarity_rank);
    const mgRank = Number.isFinite(rankMg) && rankMg > 0 ? rankMg : null;
    for (const e of d.events ?? []) {
      if (e.type !== 2 || !((e.xch_price ?? 0) > 0)) continue;
      if ((e.payments ?? []).some((p) => p.asset_id)) continue; // XCH-only
      salesRaw.push({ id: ids[k], rank: mgRank ?? 0, price: e.xch_price!, ageDays: 0, traits,
        seller: e.previous_address?.encoded_id ?? undefined, buyer: e.address?.encoded_id ?? undefined,
        date: e.timestamp ? new Date(e.timestamp).getTime() : 0 });
    }
  });
  if (supply <= 0) supply = perNft.length;

  // Own ranks for unranked collections (sorted IC score -> scaled to supply), mirroring production.
  const anyMg = salesRaw.some((s) => s.rank > 0);
  if (!anyMg && freq) {
    const est = buildRankEstimator(freq, perNft.length);
    if (est) {
      const scored = perNft.map((n) => ({ id: n.id, score: est.scoreOf(n.traits.map((t) => ({ trait_type: t.k, value: t.v }))) }));
      scored.sort((a, b) => b.score - a.score);
      const M = scored.length; const rankById = new Map<string, number>();
      scored.forEach((e, idx) => rankById.set(e.id, Math.max(1, Math.min(supply, Math.round(((idx + 0.5) / M) * supply)))));
      for (const s of salesRaw) s.rank = rankById.get(s.id) ?? 0;
    }
  }
  const sales = salesRaw.filter((s) => s.rank > 0 && s.date > 0).sort((a, b) => a.date - b.date);
  console.log(`  ${sales.length} historical XCH sales; running leave-future-out backtest…`);

  // Leave-future-out: estimate each sale from sales strictly before it.
  const errs: number[] = []; let clipped = 0; const WARMUP = 8;
  for (let n = 0; n < sales.length; n++) {
    const s = sales[n];
    const rf = rarityFactorForPercentile((s.rank / supply) * 100);
    const base = floor * (1 + rf);
    if (s.price < 0.2 * base || s.price > 5 * base) clipped++;
    if (n < WARMUP) continue;
    const prior = sales.slice(0, n).map((p) => ({ rank: p.rank, price: p.price, traits: p.traits,
      seller: p.seller, buyer: p.buyer, ageDays: Math.max(0, (s.date - p.date) / 86_400_000) } as Sale));
    const model = buildCompsModel(prior, supply, { floor, rarityFactor: rarityFactorForPercentile, traitFreq: freq });
    if (!model) continue;
    const est = model.valueOf(s.rank, s.traits).value ?? model.curveValue(s.rank);
    if (est > 0) errs.push(Math.abs(est - s.price) / s.price);
  }

  errs.sort((a, b) => a - b);
  const med = errs.length ? errs[Math.floor(errs.length / 2)] : NaN;
  const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN;
  const within = (t: number) => errs.length ? (errs.filter((e) => e <= t).length / errs.length) * 100 : 0;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log("\n──────── RESULT ────────");
  console.log(`floor anchor:            ${floor} XCH   supply: ${supply}   ranked: ${anyMg ? "MintGarden" : "own IC"}`);
  console.log(`sales evaluated:         ${errs.length} (of ${sales.length}, warmup ${WARMUP})`);
  console.log(`median abs % error:      ${errs.length ? pct(med) : "n/a"}`);
  console.log(`mean abs % error:        ${errs.length ? pct(mean) : "n/a"}`);
  console.log(`within ±25% / ±50%:      ${within(0.25).toFixed(1)}% / ${within(0.5).toFixed(1)}%`);
  console.log(`clamp [0.2x,5x] clips:   ${clipped}/${sales.length} sales (${sales.length ? pct(clipped / sales.length) : "n/a"}) — check these are wash/outliers, not legit grails`);
}
main().catch((e) => { console.error(e); process.exit(1); });
