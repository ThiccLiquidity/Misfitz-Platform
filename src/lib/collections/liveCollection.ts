import { getCollection, listCollectionNfts } from "@/lib/data-sources/mintgarden/client";
import { mapListItemToCard, isDisplayableNft } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, fetchCollectionFloor, fetchCollectionSaleFloor, fetchCollectionFloorWarm, fetchCollectionSaleFloorWarm, fetchCollectionActiveOffers, type CollectionOffer, XCH_USD_FALLBACK } from "@/lib/market/dexie";
import { computeDealScore } from "@/lib/rarity/enrich";
import { getCompsModel } from "@/lib/valuation/compsService";
import { getCollectionFrequency } from "@/lib/rarity/collectionFrequency";
import { cacheGet, cachePut } from "@/lib/db/nftCache";
import { estimateFairValue } from "@/lib/valuation/estimate";
import { isCompsEnabled } from "@/lib/config";
import type { MgCollection, MgListItem, MgPage } from "@/lib/data-sources/mintgarden/types";
import type { NftData } from "@/types";

// Powers the live collection binder (/collection/[id]). Loads a page of the collection's NFTs as
// fast cards (rank from the indexer + floor-anchored value); traits + estimated ranks stream in via
// the shared enrichment route, exactly like the wallet binder. Large collections paginate by cursor.

export interface CollectionView {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  totalSupply: number;
  floorXch: number | null;
  volumeXch: number | null;
  verified: boolean;
  xchUsdRate: number;
  nfts: NftData[];
  cursor: string | null;
}

// Floor precedence mirrors the wallet binder: live Dexie ask -> MintGarden floor -> recent Dexie sales.
async function resolveCollectionFloorXch(id: string, mgFloor: number | null): Promise<number | null> {
  const [dexie, sale] = await Promise.all([
    fetchCollectionFloor(id).catch(() => null),
    fetchCollectionSaleFloor(id).catch(() => null),
  ]);
  if (typeof dexie === "number") return dexie;
  if (mgFloor !== null) return mgFloor;
  if (typeof sale === "number") return sale;
  return null;
}

// Non-blocking floor for SSR first paint: use the cached Dexie floor if warm, else MintGarden's floor,
// else the cached sale floor — never awaits the network. The exact Dexie floor lands via /all shortly
// after. Keeps the collection page painting in ~1-2s instead of waiting on Dexie.
function resolveCollectionFloorXchWarm(id: string, mgFloor: number | null): number | null {
  const dexie = fetchCollectionFloorWarm(id);
  if (typeof dexie === "number") return dexie;
  if (mgFloor !== null) return mgFloor;
  const sale = fetchCollectionSaleFloorWarm(id);
  return typeof sale === "number" ? sale : null;
}

function cardsFrom(items: Awaited<ReturnType<typeof listCollectionNfts>>["items"], col: MgCollection, floorXch: number | null, rate: number): NftData[] {
  return items
    .filter((it) => isDisplayableNft({ is_blocked: it.is_blocked, blocked_content: it.collection_blocked_content }))
    .map((it) => {
      const m = mapListItemToCard(it, col, floorXch, rate);
      return { ...m.nft, totalSupply: m.totalSupply, collectionName: m.collectionName };
    });
}

export async function getCollectionView(id: string, size = 60): Promise<CollectionView | null> {
  if (!id.startsWith("col1")) return null;
  const [col, rate] = await Promise.all([getCollection(id).catch(() => null), fetchXchUsdRate()]);
  if (!col) return null;
  const xchUsdRate = rate ?? XCH_USD_FALLBACK;
  const page = await listCollectionNfts(id, undefined, size).catch(() => ({ items: [], next: null, previous: null }));
  const floorXch = resolveCollectionFloorXchWarm(id, typeof col.floor_price === "number" ? col.floor_price : null);

  return {
    id,
    name: col.name,
    description: col.description ?? null,
    imageUrl: col.thumbnail_uri ?? null,
    bannerUrl: col.banner_uri ?? null,
    totalSupply: col.nft_count ?? 0,
    floorXch,
    volumeXch: typeof col.volume === "number" ? col.volume : null,
    verified: col.creator?.verification_state === 1,
    xchUsdRate,
    // SSR cards show rank + value + image immediately, but NOT listings/deals — those are Dexie-verified
    // in getAllCollectionCards (/all) so a MintGarden XCH-only price can never flash as a misleading deal.
    nfts: cardsFrom(page.items ?? [], col, floorXch, xchUsdRate).map((n) => ({
      ...n,
      listing: null,
      dealScore: null,
      listingAssets: null,
      listingRequested: null,
      dexieOfferId: null,
    })),
    cursor: page.next ?? null,
  };
}

// Next page of cards for "load more" (the collection + floor are TTL-cached, so this is cheap).
export async function getCollectionNftsPage(id: string, cursor: string, size = 60): Promise<{ nfts: NftData[]; cursor: string | null }> {
  if (!id.startsWith("col1")) return { nfts: [], cursor: null };
  const [col, rate] = await Promise.all([getCollection(id).catch(() => null), fetchXchUsdRate()]);
  if (!col) return { nfts: [], cursor: null };
  const xchUsdRate = rate ?? XCH_USD_FALLBACK;
  const [page, floorXch] = await Promise.all([
    listCollectionNfts(id, cursor, size).catch(() => ({ items: [], next: null, previous: null })),
    resolveCollectionFloorXch(id, typeof col.floor_price === "number" ? col.floor_price : null),
  ]);
  return { nfts: cardsFrom(page.items ?? [], col, floorXch, xchUsdRate), cursor: page.next ?? null };
}

// ── Full collection (rarity-sorted) ───────────────────────────────────────────
// MintGarden has no server-side rarity sort, so to show "the rarest in the whole collection" we page
// through every NFT (slim list items carry openrarity_rank for ranked collections), sort by rank, and
// cache the result. First call for a collection is slow (sequential paging); after that it's instant
// for 10 min. The binder renders only the visible slice, so big collections stay light in the DOM.
interface BaseCollection { cards: NftData[]; floorXch: number | null; xchUsdRate: number; capped: boolean }
const _fullCache = new Map<string, { value: BaseCollection; expiresAt: number }>();
const FULL_PAGE_SIZE = 100;
const MAX_PAGES = 120; // safety cap (~12k NFTs); larger collections show their rarest ~12k

export interface FullCollection {
  nfts: NftData[]; // sorted rarest-first (rank asc; unranked last)
  total: number;
  capped: boolean;
  // Trait values selling hotter than their prevalence right now (normalized type/value) — feeds the
  // filter bar's 🔥 markers. Empty when comps are cold/disabled.
  hotTraits?: { type: string; value: string; ratio: number }[];
  // True while the comparable-sales model is still building in the background (values/hot-traits will
  // sharpen on the next load). Lets the UI show a "warming up" indicator.
  warming?: boolean;
}

async function buildBaseCollection(id: string): Promise<BaseCollection> {
  if (!id.startsWith("col1")) return { cards: [], floorXch: null, xchUsdRate: XCH_USD_FALLBACK, capped: false };
  const hit = _fullCache.get(id);
  if (hit && Date.now() < hit.expiresAt) return hit.value;

  const [col, rate] = await Promise.all([getCollection(id).catch(() => null), fetchXchUsdRate()]);
  if (!col) return { cards: [], floorXch: null, xchUsdRate: XCH_USD_FALLBACK, capped: false };
  const xchUsdRate = rate ?? XCH_USD_FALLBACK;
  // Kick off the floor + Dexie active-offers fetches in parallel with the (sequential) NFT paging.
  const floorPromise = resolveCollectionFloorXch(id, typeof col.floor_price === "number" ? col.floor_price : null);
  const offersPromise = fetchCollectionActiveOffers(id).catch(() => new Map<string, CollectionOffer>());

  // The slim NFT list is the slow part (sequential cursor paging — 30-70s for a big collection). Persist
  // it so a restart doesn't re-page the whole collection; refresh window is modest (new mints appear then).
  let items: MgListItem[] = [];
  let capped = false;
  const slimHit = await cacheGet(`slimlist:${id}`, 30 * 60_000);
  if (slimHit) {
    try {
      const parsed = JSON.parse(slimHit) as { items: MgListItem[]; capped: boolean };
      items = parsed.items ?? [];
      capped = Boolean(parsed.capped);
    } catch { /* re-page */ }
  }
  if (items.length === 0) {
    let cursor: string | null | undefined = undefined;
    let pages = 0;
    do {
      const page: MgPage<MgListItem> = await listCollectionNfts(id, cursor, FULL_PAGE_SIZE, true).catch(() => ({ items: [], next: null, previous: null }));
      items.push(...(page.items ?? []));
      cursor = page.next;
      pages += 1;
      if (pages >= MAX_PAGES) { capped = Boolean(cursor); break; }
    } while (cursor);
    if (items.length > 0) cachePut(`slimlist:${id}`, JSON.stringify({ items, capped }));
  }

  const [floorFallback, offerMap] = await Promise.all([floorPromise, offersPromise]);

  // Floor = cheapest CLEAN single-NFT XCH offer from Dexie. The scan now queries requested=xch&sort=
  // price_asc (Dexie only honors the price sort when a requested asset is set), so it actually returns
  // the cheapest offers — including creator/primary listings (e.g. 0.2 XCH) that the old date-ordered
  // scan missed past its page cap. Dexie carries the FULL requested[] for every offer, so a hidden-CAT
  // offer (XCH + CAT) is detected exactly (xchOnly=false) rather than guessed from a price denomination.
  const floorCandidates: number[] = [];
  for (const o of offerMap.values()) {
    if (o.xchOnly && !o.multiNft && o.priceXch > 0) floorCandidates.push(o.priceXch);
  }
  const floorXch = floorCandidates.length ? Math.min(...floorCandidates) : floorFallback;
  const cards = cardsFrom(items, col, floorXch, xchUsdRate);

  // Listings come from Dexie (authoritative, full asset terms):
  //   • Single-NFT, XCH-only offer  → real listing + deal score.
  //   • Single-NFT, XCH+CAT offer   → listing shown, NO deal score, CAT breakdown flagged (the price is
  //                                    only the XCH leg; we don't value CATs).
  //   • Bundle (multi-NFT) offer    → no per-NFT listing.
  //   • Not on Dexie at all, but MintGarden shows a price → UNVERIFIED listing: we can't see the full
  //     offer terms (could hide a CAT), so we show the price with NO deal score and never let it set the
  //     floor. The modal tells the user to confirm the real terms on MintGarden before buying.
  for (const card of cards) {
    const offer = offerMap.get(card.id);
    if (offer && !offer.multiNft) {
      card.listing = { priceXch: offer.priceXch, priceUsd: Math.round(offer.priceXch * xchUsdRate * 100) / 100 };
      card.listingAssets = offer.requested.map((r) => r.code);
      card.listingRequested = offer.requested;
      card.dexieOfferId = offer.offerId;
      card.listingUnverified = false;
      card.dealScore = offer.xchOnly && card.fairValue && offer.priceXch > 0
        ? computeDealScore(card.fairValue.totalEstimate, offer.priceXch)
        : null;
    } else if (offer && offer.multiNft) {
      card.listing = null;
      card.listingAssets = null;
      card.listingRequested = null;
      card.dexieOfferId = null;
      card.listingUnverified = false;
      card.dealScore = null;
    } else if (card.listing) {
      // Listed on MintGarden's marketplace (not on Dexie). MintGarden marketplace listings are XCH-priced,
      // so we treat the shown price as an XCH-only ask and DO score it. We keep a soft "confirm on
      // MintGarden" note (listingUnverified) since we didn't read the raw offer terms, but no longer hide
      // the deal score — that made overpriced MintGarden listings render as a neutral/green "no score".
      card.listingAssets = ["XCH"];
      card.listingRequested = [{ code: "XCH", amount: card.listing.priceXch }];
      card.dexieOfferId = null;
      card.listingUnverified = true;
      card.dealScore = card.fairValue && card.listing.priceXch > 0
        ? computeDealScore(card.fairValue.totalEstimate, card.listing.priceXch)
        : null;
    } else {
      card.listingAssets = null;
      card.listingRequested = null;
      card.dexieOfferId = null;
      card.listingUnverified = false;
      card.dealScore = null;
    }
  }

  cards.sort((a, b) => (a.rarityRank ?? Infinity) - (b.rarityRank ?? Infinity)); // rarest first, unranked last
  const base: BaseCollection = { cards, floorXch, xchUsdRate, capped };
  _fullCache.set(id, { value: base, expiresAt: Date.now() + 10 * 60_000 });
  return base;
}

// Public entry: base cards (cached 10 min) with the comparable-sales blend applied ON READ. The blend is
// cheap arithmetic over the independently-cached comps model, so the instant that model finishes building
// in the background it appears on the very next request — it is NOT trapped behind the 10-min card cache.
export async function getAllCollectionCards(id: string): Promise<FullCollection> {
  const base = await buildBaseCollection(id);
  const { floorXch, xchUsdRate } = base;

  // If MintGarden hasn't ranked this collection, apply OUR OWN computed ranks (from the persisted rarity
  // build). The collection is fully browsable meanwhile; once the build finishes, `warming` flips off and
  // the ranks/tiers appear on the next poll. Guarded so ranked collections are untouched.
  let cards = base.cards;
  let rarityWarming = false;
  if (id.startsWith("col1") && !base.cards.some((c) => c.rarityRank != null)) {
    const rarity = await getCollectionFrequency(id).catch(() => null);
    if (rarity && Object.keys(rarity.rankById).length > 0) {
      // Our ranks run 1..M over the NFTs we could actually rank (traited + successfully fetched). The
      // tier bands divide rank by the card's display supply, so if M < supply — big collections capped
      // at 2000, traitless NFTs, or fetch gaps — the largest rank would only reach percentile M/supply
      // and NOTHING lands in the common band (every count skews rare). Scale each rank to the display
      // supply so rank/supply is the TRUE percentile within the ranked set and each tier gets its share.
      const M = Object.keys(rarity.rankById).length;
      cards = base.cards
        .map((c) => {
          const r = rarity.rankById[c.id];
          if (r == null) return c;
          const supply = c.totalSupply ?? rarity.total;
          const scaledRank = Math.max(1, Math.min(supply, Math.round(((r - 0.5) / M) * supply)));
          const fairValue = floorXch != null
            ? estimateFairValue({ floorXch, rarityRank: scaledRank, totalSupply: supply, xchUsdRate })
            : c.fairValue;
          // Recompute the deal score now that this (MintGarden-unranked) card finally has a value.
          // Its deal score was null in buildBaseCollection (no rank yet -> no fairValue), and the comps
          // path never runs for unranked collections (their comps model needs openrarity_rank), so
          // WITHOUT this the deal finder shows nothing for exactly these collections.
          const xchOnly = !!c.listingRequested && c.listingRequested.length === 1 && c.listingRequested[0].code === "XCH";
          const dealScore = c.listing && c.dexieOfferId && xchOnly && fairValue && c.listing.priceXch > 0
            ? computeDealScore(fairValue.totalEstimate, c.listing.priceXch)
            : c.dealScore;
          return { ...c, rarityRank: scaledRank, rankEstimated: true, fairValue, dealScore };
        })
        .sort((a, b) => (a.rarityRank ?? Infinity) - (b.rarityRank ?? Infinity));
    } else {
      rarityWarming = true; // our rarity build isn't ready yet
    }
  }

  const result = (nfts: NftData[], hotTraits: { type: string; value: string; ratio: number }[] = [], warming = false) =>
    ({ nfts, total: nfts.length, capped: base.capped, hotTraits, warming: warming || rarityWarming });
  if (!isCompsEnabled()) return result(cards, [], false);
  const comps = await getCompsModel(id).catch(() => null);
  if (!comps) return result(cards, [], true); // cold model → warming; old values until the background build warms up

  const nfts = cards.map((card) => {
    if (card.rarityRank == null || !card.fairValue) return card;
    const traits = card.traits?.map((t) => ({ k: t.trait_type, v: String(t.value) }));
    const cv = comps.valueOf(card.rarityRank, traits);
    if (cv.value == null) return card;
    // The market curve (curve × trait amplifier) REPLACES floor+rarity+comps; the collector-number
    // premium is the only thing added on top.
    // Collector-number premium is MULTIPLICATIVE on the curve price (weight derived from the additive
    // desirability premium computed earlier: desirability = floor × weight).
    const numberWeight = floorXch && floorXch > 0 ? Math.max(0, (card.fairValue.desirabilityPremium ?? 0) / floorXch) : 0;
    const collectorMult = 1 + numberWeight;
    const total = Math.round(Math.max(floorXch ?? 0, cv.value * collectorMult) * 1000) / 1000;
    const fairValue = { ...card.fairValue, totalEstimate: total, totalEstimateUsd: Math.round(total * xchUsdRate * 100) / 100 };
    const xchOnly = !!card.listingRequested && card.listingRequested.length === 1 && card.listingRequested[0].code === "XCH";
    const dealScore = card.listing && xchOnly && card.listing.priceXch > 0
      ? computeDealScore(total, card.listing.priceXch)
      : card.dealScore;
    return {
      ...card, fairValue, dealScore,
      valueBasis: cv.basis,
      valueConfidence: Math.round(cv.confidence * 100) / 100,
      valueSampleSize: comps.sampleSize,
      valueCurve: cv.curve != null ? Math.round(cv.curve * 1000) / 1000 : null,
      valueTraitMult: Math.round(cv.traitMult * 1000) / 1000,
      valueTraitTop: cv.traitTop ?? null,
    };
  });
  return result(nfts, comps.hotTraits(), false);
}
