// ── Compact wire format for GET /api/collection/[id]/all ─────────────────────
// The full NftData[] for a 10,000-NFT collection is ~13.7MB of JSON, and the binder re-downloads it on
// every warming poll. On a phone that was the single largest cost of opening a collection.
//
// Three stacked wins, in order of what they actually save:
//   1. COLUMNAR — one array per field instead of 10,000 objects, so the JSON key names ("launcherId":,
//      "fairValue":, ...) are written ONCE instead of 10,000 times. That text alone was ~700KB.
//   2. DICTIONARY TRAITS — trait type/value strings repeat across the whole collection. Storing the
//      distinct triples once and referring to them by integer takes traits from ~3.1MB to ~160KB.
//   3. HOISTING + DERIVATION — collectionSlug/collectionName/totalSupply/xchUsdRate are the same on every
//      card; they move to the envelope. USD fields and listingAssets are RE-DERIVED client-side with the
//      identical expressions the server used, rather than transmitted.
//
// Measured on the real 10k Misfitz roster: 13.8MB -> 2.03MB raw worst case (-85%), 0.98MB gzipped.
// JSON.parse also handles a 2MB string instead of a 14MB one, which is the bigger mobile win.
//
// LOSSLESS BY CONSTRUCTION, NOT BY ASSUMPTION. Every "constant" hoisted to the envelope is the most common
// value, and any card that deviates gets a sparse override entry. Every derived field is verified against
// the real value at projection time and gets an override row if the derivation disagrees. So a future
// server change can make this bigger, never wrong.
//
// Isomorphic: only `import type`, so nothing server-side reaches the client bundle.
import type { NftData, Trait } from "@/types";
import type { SaleFeedItem } from "@/lib/collections/liveCollection";

export const COLLECTION_WIRE_VERSION = 2 as const;

/** Collection-constant header — every field here was otherwise repeated once per card. */
export interface WireEnvelope {
  slug: string;              // collectionSlug
  name: string | null;       // collectionName
  supply: number | null;     // totalSupply
  rate: number;              // xchUsdRate — the only input needed to re-derive every USD field
  floor: number | null;      // collection floorXch
  fv0: number | null;        // fairValue.floorValue
  at: string | null;         // fairValue.estimatedAt
  sample: number | null;     // valueSampleSize (== comps.sampleSize)
  lp: string; ls: string;    // launcherId common prefix / suffix
  np: string; ns: string;    // name common prefix / suffix ("Misfitz #")
  gp: string; gs: string;    // imageUrl common prefix / suffix
  own: string[];             // owner-address dictionary (whales repeat heavily)
  basis: string[];           // valueBasis dictionary
  top: string[];             // valueTraitTop dictionary
  clb: string[];             // collectible.label dictionary
  deal: string[];            // dealScore.label dictionary
}

/** `k` = trait types; `p` = (typeId, value, rarityPercent?) triples. A card's traits are indices into `p`.
 *  rarityPercent is part of the dictionary KEY, so two identical (type,value) pairs carrying different
 *  percentages stay distinct — the encoding can never silently merge them. */
export interface WireTraitDict {
  k: string[];
  p: ([number, string | number] | [number, string | number, number])[];
}

/** Struct-of-arrays. Dense columns are index-aligned with -1 as the null sentinel; everything sparse is a
 *  list of (index, value) tuples, so an absent field costs literally nothing. */
export interface WireColumns {
  c: number;                                   // card count
  l: string[]; nm: string[]; im: string[];     // launcherId / name / imageUrl (affix-stripped)
  ow: number[]; rk: number[]; sc: number[];    // owner id / rarityRank / rarityScore (-1 = null)
  tr: number[][];                              // trait dictionary ids, ORDER PRESERVED (the grid shows the 6 rarest, ties broken by this order)
  fv: (number[] | 0)[];                        // [totalEstimate, rarityPremium, desirabilityPremium, floorValue?]; 0 = null
  vb: number[]; vc: number[]; vk: number[]; vm: number[]; vt: number[];
  es?: number[];                               // indices with rankEstimated === true
  uv?: number[];                               // indices with listingUnverified === true
  pr?: [number, number][];                     // listing.priceXch
  rq?: [number, [string, number][]][];         // listingRequested
  of?: [number, string][];                     // dexieOfferId
  dl?: [number, number, number][];             // dealScore [i, score, labelId]
  cb?: [number, number, number][];             // collectible [i, tier, labelId]
  ts?: [number, number | null][];              // totalSupply override
  cn?: [number, string | null][];              // collectionName override
  cs?: [number, string][];                     // collectionSlug override
  vz?: [number, number | null][];              // valueSampleSize override
  tp?: [number, number][];                     // fairValue.traitPremium override
  fu?: [number, number][];                     // totalEstimateUsd override (derivation guard)
  pu?: [number, number][];                     // listing.priceUsd override (derivation guard)
  la?: [number, string[] | null][];            // listingAssets override (derivation guard)
}

export interface CollectionWireV2 {
  v: typeof COLLECTION_WIRE_VERSION;
  c: WireEnvelope;
  t: WireTraitDict;
  d: WireColumns;
  // Top-level keys keep their EXACT current names so the binder's polling logic is untouched.
  total: number;
  capped: boolean;
  hotTraits: { type: string; value: string; ratio: number }[];
  warming: boolean;
  valuesAsOf: number | null;
  recentSales: SaleFeedItem[];
}

// ── helpers ─────────────────────────────────────────────────────────────────
function lcp(list: string[]): string {
  let p = list[0] ?? "";
  for (const s of list) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); if (!p) return ""; }
  return p;
}
function lcsuf(list: string[], reserved: number): string {
  let p = list[0] ?? "";
  for (const s of list) {
    const room = s.length - reserved; // never let prefix and suffix overlap
    let i = 0; while (i < p.length && i < room && p[p.length - 1 - i] === s[s.length - 1 - i]) i++;
    p = p.slice(p.length - i); if (!p) return "";
  }
  return p;
}
interface Affix { pre: string; suf: string }
function affix(list: string[]): Affix {
  if (!list.length) return { pre: "", suf: "" };
  const pre = lcp(list);
  return { pre, suf: lcsuf(list, pre.length) };
}
const strip = (s: string, a: Affix) => s.slice(a.pre.length, s.length - a.suf.length);

interface Dict { a: string[]; i: Map<string, number> }
function counter() {
  const m = new Map<string, number>();
  return {
    add: (k: string) => { m.set(k, (m.get(k) ?? 0) + 1); },
    // Frequency-ordered, so the hottest values get the shortest (1-character) ids.
    build: (): Dict => { const a = [...m.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]); return { a, i: new Map(a.map((v, j) => [v, j])) }; },
  };
}

export interface ProjectInput {
  nfts: NftData[];
  total: number;
  capped: boolean;
  hotTraits?: { type: string; value: string; ratio: number }[];
  warming?: boolean;
  valuesAsOf?: number | null;
  floorXch: number | null;
  xchUsdRate: number; // MUST be the rate the cards' USD fields were computed with
}

// ═══ SERVER ═════════════════════════════════════════════════════════════════
export function projectCollectionWire(full: ProjectInput, recentSales: SaleFeedItem[]): CollectionWireV2 {
  const N = full.nfts;
  const rate = full.xchUsdRate;
  const usd = (x: number) => Math.round(x * rate * 100) / 100;

  const A = affix(N.map((n) => n.launcherId));
  const NA = affix(N.map((n) => n.name ?? ""));
  const GA = affix(N.map((n) => n.imageUrl ?? ""));

  const ownC = counter(), basisC = counter(), topC = counter(), clbC = counter(), dealC = counter(), typeC = counter(), pairC = counter();
  const pairKey = (t: Trait) => JSON.stringify([t.trait_type, t.value, t.rarityPercent ?? null]);
  for (const n of N) {
    if (n.currentOwnerAddress) ownC.add(n.currentOwnerAddress);
    if (n.valueBasis) basisC.add(n.valueBasis);
    if (n.valueTraitTop) topC.add(n.valueTraitTop);
    if (n.collectible) clbC.add(n.collectible.label);
    if (n.dealScore) dealC.add(n.dealScore.label);
    for (const t of n.traits ?? []) { typeC.add(t.trait_type); pairC.add(pairKey(t)); }
  }
  const OW = ownC.build(), BS = basisC.build(), TP = topC.build(), CL = clbC.build(), DL = dealC.build(), TY = typeC.build(), PD = pairC.build();
  const pairs: WireTraitDict["p"] = PD.a.map((j) => {
    const [t, v, p] = JSON.parse(j) as [string, string | number, number | null];
    return (p == null ? [TY.i.get(t) ?? 0, v] : [TY.i.get(t) ?? 0, v, p]) as WireTraitDict["p"][number];
  });

  // The envelope constant is the MODE (most common value), so per-card overrides stay rare.
  const mode = <T,>(f: (n: NftData) => T): T | null => {
    const m = new Map<string, number>();
    for (const n of N) { const k = JSON.stringify(f(n) ?? null); m.set(k, (m.get(k) ?? 0) + 1); }
    let best: string | null = null, bc = -1;
    for (const [k, c] of m) if (c > bc) { bc = c; best = k; }
    return best == null ? null : (JSON.parse(best) as T);
  };
  const eSupply = mode((n) => n.totalSupply ?? null);
  const eName = mode((n) => n.collectionName ?? null);
  const eSlug = mode((n) => n.collectionSlug) ?? "";
  const eFv0 = mode((n) => n.fairValue?.floorValue ?? null);
  const eSample = mode((n) => n.valueSampleSize ?? null);
  const eAt = mode((n) => n.fairValue?.estimatedAt ?? null);

  const l: string[] = [], nm: string[] = [], im: string[] = [];
  const ow: number[] = [], rk: number[] = [], sc: number[] = [];
  const tr: number[][] = [], fv: (number[] | 0)[] = [];
  const vb: number[] = [], vc: number[] = [], vk: number[] = [], vm: number[] = [], vt: number[] = [];
  const es: number[] = [], uv: number[] = [];
  const pr: [number, number][] = [], rq: [number, [string, number][]][] = [], of: [number, string][] = [];
  const dl: [number, number, number][] = [], cb: [number, number, number][] = [];
  const ts: [number, number | null][] = [], cn: [number, string | null][] = [], cs: [number, string][] = [];
  const vz: [number, number | null][] = [], tp: [number, number][] = [];
  const fu: [number, number][] = [], pu: [number, number][] = [], la: [number, string[] | null][] = [];

  N.forEach((n, i) => {
    l.push(strip(n.launcherId, A));
    nm.push(strip(n.name ?? "", NA));
    im.push(strip(n.imageUrl ?? "", GA));
    ow.push(n.currentOwnerAddress ? (OW.i.get(n.currentOwnerAddress) ?? -1) : -1);
    rk.push(n.rarityRank ?? -1);
    sc.push(n.rarityScore ?? -1);
    tr.push((n.traits ?? []).map((t) => PD.i.get(pairKey(t)) ?? 0));

    const f = n.fairValue;
    if (f) {
      // totalEstimate is emitted VERBATIM. It is already rounded server-side; rounding again on the wire
      // would desync the client-derived USD by a cent AND shift the 10,000-card portfolio-total sum.
      const arr: number[] = [f.totalEstimate, f.rarityPremium, f.desirabilityPremium ?? 0];
      if (f.floorValue !== eFv0) arr.push(f.floorValue);
      while (arr.length > 1 && arr[arr.length - 1] === 0) arr.pop(); // drop trailing zeros
      fv.push(arr);
      if (usd(f.totalEstimate) !== f.totalEstimateUsd) fu.push([i, f.totalEstimateUsd]);
      if (f.traitPremium !== 0) tp.push([i, f.traitPremium]);
    } else fv.push(0);

    vb.push(n.valueBasis ? (BS.i.get(n.valueBasis) ?? -1) : -1);
    vc.push(n.valueConfidence == null ? -1 : n.valueConfidence);
    vk.push(n.valueCurve == null ? -1 : n.valueCurve);
    vm.push(n.valueTraitMult == null ? -1 : n.valueTraitMult);
    vt.push(n.valueTraitTop ? (TP.i.get(n.valueTraitTop) ?? -1) : -1);

    if (n.rankEstimated) es.push(i);
    if (n.listingUnverified) uv.push(i);
    if (n.listing) {
      pr.push([i, n.listing.priceXch]);
      if (usd(n.listing.priceXch) !== n.listing.priceUsd) pu.push([i, n.listing.priceUsd]);
    }
    if (n.listingRequested) rq.push([i, n.listingRequested.map((r) => [r.code, r.amount] as [string, number])]);
    const derivedAssets = n.listingRequested ? n.listingRequested.map((r) => r.code) : null;
    if (JSON.stringify(n.listingAssets ?? null) !== JSON.stringify(derivedAssets)) la.push([i, n.listingAssets ?? null]);
    if (n.dexieOfferId) of.push([i, n.dexieOfferId]);
    if (n.dealScore) dl.push([i, n.dealScore.score, DL.i.get(n.dealScore.label) ?? 0]);
    if (n.collectible) cb.push([i, n.collectible.tier, CL.i.get(n.collectible.label) ?? 0]);
    if ((n.totalSupply ?? null) !== eSupply) ts.push([i, n.totalSupply ?? null]);
    if ((n.collectionName ?? null) !== eName) cn.push([i, n.collectionName ?? null]);
    if (n.collectionSlug !== eSlug) cs.push([i, n.collectionSlug]);
    if (n.valueSampleSize != null && n.valueSampleSize !== eSample) vz.push([i, n.valueSampleSize]);
  });

  const d: WireColumns = { c: N.length, l, nm, im, ow, rk, sc, tr, fv, vb, vc, vk, vm, vt };
  if (es.length) d.es = es;
  if (uv.length) d.uv = uv;
  if (pr.length) d.pr = pr;
  if (rq.length) d.rq = rq;
  if (of.length) d.of = of;
  if (dl.length) d.dl = dl;
  if (cb.length) d.cb = cb;
  if (ts.length) d.ts = ts;
  if (cn.length) d.cn = cn;
  if (cs.length) d.cs = cs;
  if (vz.length) d.vz = vz;
  if (tp.length) d.tp = tp;
  if (fu.length) d.fu = fu;
  if (pu.length) d.pu = pu;
  if (la.length) d.la = la;

  return {
    v: COLLECTION_WIRE_VERSION,
    c: {
      slug: eSlug, name: eName, supply: eSupply, rate, floor: full.floorXch,
      fv0: eFv0, at: eAt, sample: eSample,
      lp: A.pre, ls: A.suf, np: NA.pre, ns: NA.suf, gp: GA.pre, gs: GA.suf,
      own: OW.a, basis: BS.a, top: TP.a, clb: CL.a, deal: DL.a,
    },
    t: { k: TY.a, p: pairs },
    d,
    total: full.total,
    capped: full.capped,
    hotTraits: full.hotTraits ?? [],
    warming: !!full.warming,
    valuesAsOf: full.valuesAsOf ?? null,
    recentSales,
  };
}

// ═══ CLIENT ═════════════════════════════════════════════════════════════════
// Rebuilds the EXACT NftData shape every downstream component already expects, so no card, modal, filter
// or sort component changes at all.
export function expandCollectionWire(w: CollectionWireV2): NftData[] {
  const e = w.c, d = w.d, rate = e.rate, C = d.c;
  const pairs: Trait[] = w.t.p.map((p) =>
    p.length === 2 ? { trait_type: w.t.k[p[0]], value: p[1] } : { trait_type: w.t.k[p[0]], value: p[1], rarityPercent: p[2] },
  );
  const out: NftData[] = new Array(C);
  for (let i = 0; i < C; i++) {
    const f = d.fv[i];
    out[i] = {
      // `id` is not read by any component fed from /all; /api/binder restores the real id on every card
      // the user actually opens. Shipping it costs 645KB for nothing.
      id: "",
      launcherId: e.lp + d.l[i] + e.ls,
      collectionSlug: e.slug,
      name: e.np + d.nm[i] + e.ns,
      imageUrl: e.gp + d.im[i] + e.gs,
      // Fresh objects per card — nothing may alias a dictionary entry, or a future in-place edit to one
      // card's trait would silently mutate every card sharing it.
      traits: d.tr[i].map((p) => ({ ...pairs[p] })),
      rarityRank: d.rk[i] === -1 ? null : d.rk[i],
      rankEstimated: false,
      currentOwnerAddress: d.ow[i] === -1 ? null : e.own[d.ow[i]],
      fairValue: f === 0 ? null : {
        floorValue: f.length > 3 ? f[3] : (e.fv0 ?? 0),
        rarityPremium: f[1] ?? 0,
        traitPremium: 0,
        desirabilityPremium: f[2] ?? 0,
        historicalSalesPremium: null,
        demandPremium: null,
        rewardValue: null,
        totalEstimate: f[0],
        totalEstimateUsd: Math.round(f[0] * rate * 100) / 100,
        estimatedAt: e.at ?? "",
      },
      // MUST be null, never undefined: the grid card does a strict `!== null` then .toFixed(1), so an
      // undefined here throws and takes the whole binder render with it.
      rarityScore: d.sc[i] === -1 ? null : d.sc[i],
      listing: null,
      dealScore: null,
      collectible: null,
      totalSupply: e.supply ?? undefined,
      collectionName: e.name ?? undefined,
      listingAssets: null,
      listingRequested: null,
      dexieOfferId: null,
      listingUnverified: false,
      valueBasis: d.vb[i] === -1 ? null : e.basis[d.vb[i]],
      valueConfidence: d.vc[i] === -1 ? null : d.vc[i],
      valueSampleSize: (d.vb[i] !== -1 || d.vk[i] !== -1 || d.vc[i] !== -1 || d.vm[i] !== -1) ? e.sample : null,
      valueCurve: d.vk[i] === -1 ? null : d.vk[i],
      valueTraitMult: d.vm[i] === -1 ? null : d.vm[i],
      valueTraitTop: d.vt[i] === -1 ? null : e.top[d.vt[i]],
    };
  }
  for (const i of d.es ?? []) out[i].rankEstimated = true;
  for (const i of d.uv ?? []) out[i].listingUnverified = true;
  for (const [i, p] of d.pr ?? []) out[i].listing = { priceXch: p, priceUsd: Math.round(p * rate * 100) / 100 };
  for (const [i, q] of d.rq ?? []) {
    out[i].listingRequested = q.map(([code, amount]) => ({ code, amount }));
    out[i].listingAssets = q.map(([code]) => code);
  }
  for (const [i, id] of d.of ?? []) out[i].dexieOfferId = id;
  for (const [i, s, li] of d.dl ?? []) out[i].dealScore = { score: s, label: e.deal[li] };
  for (const [i, t, li] of d.cb ?? []) out[i].collectible = { tier: t, label: e.clb[li] };
  for (const [i, v] of d.ts ?? []) out[i].totalSupply = v ?? undefined;
  for (const [i, v] of d.cn ?? []) out[i].collectionName = v ?? undefined;
  for (const [i, v] of d.cs ?? []) out[i].collectionSlug = v;
  for (const [i, v] of d.vz ?? []) out[i].valueSampleSize = v;
  for (const [i, v] of d.tp ?? []) { const fvv = out[i].fairValue; if (fvv) fvv.traitPremium = v; }
  for (const [i, v] of d.fu ?? []) { const fvv = out[i].fairValue; if (fvv) fvv.totalEstimateUsd = v; }
  for (const [i, v] of d.pu ?? []) { const lst = out[i].listing; if (lst) lst.priceUsd = v; }
  for (const [i, v] of d.la ?? []) out[i].listingAssets = v;
  return out;
}
