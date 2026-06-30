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

  // Floor = cheapest CLEAN XCH listing across BOTH books:
  //   • Dexie active offers that request XCH only (CAT offers excluded — their tiny XCH leg isn't a floor)
  //   • MintGarden-native listings (item.price) for NFTs NOT on Dexie — these are creator/primary listings
  //     (CAT "traps" live on Dexie, so a MintGarden-only listing is a clean XCH sale, e.g. a creator
  //     selling inventory at 0.2 XCH). This is what makes the true floor show up instead of the
  //     higher secondary-market Dexie floor.
  const itemById = new Map(items.map((it) => [it.id, it] as const));
  const floorCandidates: number[] = [];
  for (const o of offerMap.values()) {
    if (o.xchOnly && !o.multiNft && o.priceXch > 0) floorCandidates.push(o.priceXch);
  }
  for (const it of items) {
    // Only XCH-denominated MintGarden listings count toward the floor — a CAT-denominated leg must not
    // masquerade as a cheap XCH floor. (token_code is "XCH"/absent for clean offers, a CAT code otherwise.)
    const mgClean = it.token_code == null || it.token_code === "XCH";
    if (mgClean && typeof it.price === "number" && it.price > 0 && !offerMap.has(it.id)) floorCandidates.push(it.price);
  }
  const floorXch = floorCandidates.length ? Math.min(...floorCandidates) : floorFallback;
  const cards = cardsFrom(items, col, floorXch, xchUsdRate);

  // Listings: Dexie is authoritative where it has the NFT (full asset terms). Dexie's price is only the
  // XCH leg, so an offer that also wants a CAT gets NO deal score and is flagged. NFTs not on Dexie keep
  // their MintGarden listing (clean XCH) so creator/primary floors are recognized. Bundles get no listing.
  for (const card of cards) {
    const offer = offerMap.get(card.id);
    if (offer && !offer.multiNft) {
      card.listing = { priceXch: offer.priceXch, priceUsd: Math.round(offer.priceXch * xchUsdRate * 100) / 100 };
      card.listingAssets = offer.requested.map((r) => r.code);
      card.listingRequested = offer.requested;
      card.dexieOfferId = offer.offerId;
      card.dealScore = offer.xchOnly && card.fairValue && offer.priceXch > 0
        ? computeDealScore(card.fairValue.totalEstimate, offer.priceXch)
        : null;
    } else if (offer && offer.multiNft) {
      card.listing = null;
      card.listingAssets = null;
      card.listingRequested = null;
      card.dexieOfferId = null;
      card.dealScore = null;
    } else {
      // Not on Dexie. Keep the MintGarden-native listing only if it's XCH-denominated (clean sale, e.g.
      // a creator listing at 0.2 XCH). A CAT-denominated listing is dropped — we don't value CATs.
      const it = itemById.get(card.id);
      const mgClean = !it || it.token_code == null || it.token_code === "XCH";
      if (card.listing && mgClean) {
        card.listingAssets = ["XCH"];
        card.listingRequested = [{ code: "XCH", amount: card.listing.priceXch }];
        card.dexieOfferId = null;
        // card.listing + card.dealScore from cardsFrom (MintGarden XCH price) are kept as-is.
      } else {
        card.listing = null;
        card.listingAssets = null;
        card.listingRequested = null;
        card.dexieOfferId = null;
        card.dealScore = null;
      }
    }
  }

  cards.sort((a, b) => (a.rarityRank ?? Infinity) - (b.rarityRank ?? Infinity)); // rarest first, unranked last
  _fullCache.set(id, { value: cards, expiresAt: Date.now() + 10 * 60_000 });
  return { nfts: cards, total: cards.length, capped };
}
