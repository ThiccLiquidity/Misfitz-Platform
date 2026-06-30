import { getCollection, listCollectionNfts } from "@/lib/data-sources/mintgarden/client";
import { mapListItemToCard, isDisplayableNft } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, fetchCollectionFloor, fetchCollectionSaleFloor, fetchCollectionActiveOffers, type CollectionOffer, XCH_USD_FALLBACK } from "@/lib/market/dexie";
import { computeDealScore } from "@/lib/rarity/enrich";
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

  // Floor = cheapest CLEAN single-NFT XCH offer (what you can actually grab in plain XCH). This keeps a
  // hidden-CAT offer's tiny XCH portion from masquerading as the floor. Falls back to the Dexie/MG floor.
  let cleanFloor: number | null = null;
  for (const o of offerMap.values()) {
    if (o.xchOnly && !o.multiNft && o.priceXch > 0) {
      cleanFloor = cleanFloor === null ? o.priceXch : Math.min(cleanFloor, o.priceXch);
    }
  }
  const floorXch = cleanFloor ?? floorFallback;
  const cards = cardsFrom(items, col, floorXch, xchUsdRate);

  // Listings are Dexie-authoritative. priceXch is the XCH-EQUIVALENT total (CAT value already folded in
  // by Dexie), so the deal score is honest even for offers that also want a CAT. Bundle offers (multiple
  // NFTs) get no per-NFT deal score. Cards with no Dexie offer are simply not "for sale" here.
  for (const card of cards) {
    const offer = offerMap.get(card.id);
    if (offer && !offer.multiNft) {
      card.listing = { priceXch: offer.priceXch, priceUsd: Math.round(offer.priceXch * xchUsdRate * 100) / 100 };
      card.listingAssets = offer.requested.map((r) => r.code);
      card.listingRequested = offer.requested;
      card.dexieOfferId = offer.offerId;
      // Only a clean XCH-only offer gets a deal score. Dexie's price is just the XCH leg, so an offer
      // that also wants a CAT (e.g. 0.25 XCH + 420k BEPE) would score absurdly high on the XCH alone.
      card.dealScore = offer.xchOnly && card.fairValue && offer.priceXch > 0
        ? computeDealScore(card.fairValue.totalEstimate, offer.priceXch)
        : null;
    } else {
      card.listing = null;
      card.listingAssets = null;
      card.listingRequested = null;
      card.dexieOfferId = null;
      card.dealScore = null;
    }
  }

  cards.sort((a, b) => (a.rarityRank ?? Infinity) - (b.rarityRank ?? Infinity)); // rarest first, unranked last
  _fullCache.set(id, { value: cards, expiresAt: Date.now() + 10 * 60_000 });
  return { nfts: cards, total: cards.length, capped };
}
