import { getCollection, listCollectionNfts } from "@/lib/data-sources/mintgarden/client";
import { mapListItemToCard, isDisplayableNft } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, fetchCollectionFloor, fetchCollectionSaleFloor, fetchCollectionActiveOffers, type CollectionOffer, XCH_USD_FALLBACK } from "@/lib/market/dexie";
import { computeDealScore } from "@/lib/rarity/enrich";
import { getCompsModel } from "@/lib/valuation/compsService";
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
  const [page, floorXch] = await Promise.all([
    listCollectionNfts(id, undefined, size).catch(() => ({ items: [], next: null, previous: null })),
    resolveCollectionFloorXch(id, typeof col.floor_price === "number" ? col.floor_price : null),
  ]);

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
const _fullCache = new Map<string, { value: NftData[]; expiresAt: number }>();
const FULL_PAGE_SIZE = 100;
const MAX_PAGES = 120; // safety cap (~12k NFTs); larger collections show their rarest ~12k

export interface FullCollection {
  nfts: NftData[]; // sorted rarest-first (rank asc; unranked last)
  total: number;
  capped: boolean;
}

export async function getAllCollectionCards(id: string): Promise<FullCollection> {
  if (!id.startsWith("col1")) return { nfts: [], total: 0, capped: false };
  const hit = _fullCache.get(id);
  if (hit && Date.now() < hit.expiresAt) return { nfts: hit.value, total: hit.value.length, capped: false };

  const [col, rate] = await Promise.all([getCollection(id).catch(() => null), fetchXchUsdRate()]);
  if (!col) return { nfts: [], total: 0, capped: false };
  const xchUsdRate = rate ?? XCH_USD_FALLBACK;
  // Kick off the floor + Dexie active-offers fetches in parallel with the (sequential) NFT paging.
  const floorPromise = resolveCollectionFloorXch(id, typeof col.floor_price === "number" ? col.floor_price : null);
  const offersPromise = fetchCollectionActiveOffers(id).catch(() => new Map<string, CollectionOffer>());

  const items: MgListItem[] = [];
  let cursor: string | null | undefined = undefined;
  let pages = 0;
  let capped = false;
  do {
    const page: MgPage<MgListItem> = await listCollectionNfts(id, cursor, FULL_PAGE_SIZE).catch(() => ({ items: [], next: null, previous: null }));
    items.push(...(page.items ?? []));
    cursor = page.next;
    pages += 1;
    if (pages >= MAX_PAGES) { capped = Boolean(cursor); break; }
  } while (cursor);

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

  // Comparable-sales blend (behind a flag; old estimate is the fallback). The model is cached/built in
  // the background — getCompsModel returns null on a cold cache so this NEVER blocks the request. Where
  // real sales sit near an NFT's rank, we pull its value toward the sales-implied number, weighted by
  // confidence; thin evidence leaves the existing estimate essentially untouched. Done before the deal
  // overlay so deal scores reflect the blended value.
  if (isCompsEnabled()) {
    const comps = await getCompsModel(id).catch(() => null);
    if (comps) {
      for (const card of cards) {
        if (card.rarityRank == null || !card.fairValue) continue;
        const traits = card.traits?.map((t) => ({ k: t.trait_type, v: String(t.value) }));
        const cv = comps.valueOf(card.rarityRank, traits);
        if (cv.value == null || cv.confidence <= 0) continue;
        const w = cv.confidence;
        const blended = w * cv.value + (1 - w) * card.fairValue.totalEstimate;
        const clamped = floorXch != null ? Math.max(floorXch, blended) : blended;
        card.fairValue = {
          ...card.fairValue,
          totalEstimate: Math.round(clamped * 1000) / 1000,
          totalEstimateUsd: Math.round(clamped * xchUsdRate * 100) / 100,
        };
        card.valueBasis = cv.basis;
        card.valueConfidence = Math.round(cv.confidence * 100) / 100;
      }
    }
  }

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
      // MintGarden shows a price but Dexie has no offer we can read → unverified. Show price, no deal score.
      card.listingAssets = null;
      card.listingRequested = null;
      card.dexieOfferId = null;
      card.listingUnverified = true;
      card.dealScore = null;
    } else {
      card.listingAssets = null;
      card.listingRequested = null;
      card.dexieOfferId = null;
      card.listingUnverified = false;
      card.dealScore = null;
    }
  }

  cards.sort((a, b) => (a.rarityRank ?? Infinity) - (b.rarityRank ?? Infinity)); // rarest first, unranked last
  _fullCache.set(id, { value: cards, expiresAt: Date.now() + 10 * 60_000 });
  return { nfts: cards, total: cards.length, capped };
}
