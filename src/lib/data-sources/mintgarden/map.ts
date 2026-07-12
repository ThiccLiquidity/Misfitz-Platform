import type { CollectionData, CollectionSummary, FairValueEstimate, ListingData, NftData, Trait } from "@/types";
import { computeDealScore } from "@/lib/rarity/enrich";
import { estimateFairValue } from "@/lib/valuation/estimate";
import { collectibleNumber } from "@/lib/rarity/collectibleNumbers";
import { XCH_USD_FALLBACK } from "@/lib/market/dexie";
import type { MgCollection, MgListItem, MgNftDetail } from "./types";
import { buildRankEstimator, type RankEstimator } from "@/lib/rarity/estimateRank";
import { declaredRarityTier, syntheticRankForTier } from "@/lib/rarity/declaredRarity";

// Pure mappers: raw MintGarden shapes -> our generic domain model (src/types). No network here.

// Safety/quality gate: never surface NFTs MintGarden has flagged as blocked. (We keep merely
// "sensitive" ones — that's a display concern, not a safety one.) Used to filter live holdings
// before they ever reach the value view, per the platform's collector-safety stance.
export function isDisplayableNft(detail: { is_blocked?: boolean | null; blocked_content?: boolean | null }): boolean {
  return detail.is_blocked !== true && detail.blocked_content !== true;
}

function round(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function parseRank(rank: string | number | null | undefined): number | null {
  if (rank === null || rank === undefined) return null;
  const n = typeof rank === "string" ? parseInt(rank, 10) : rank;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Mint/edition number for special-number badges. Prefer the number shown in the NAME (e.g. the #162
// in "MarmaLady #162") so the badge always matches what the user sees on the card — some collections'
// series_number is an internal mint-order index that disagrees with the displayed token number (e.g.
// MarmaLady #162 has series_number 13, which wrongly read as "Baker's Dozen"). Fall back to
// series_number only when the name carries no trailing number. Null when neither exists (e.g. 1/1 art).
function parseMintNumber(detail: MgNftDetail): number | null {
  const name = detail.data?.metadata_json?.name ?? "";
  const m = name.match(/#?(\d+)\s*$/);
  if (m) return parseInt(m[1], 10);
  const series = detail.data?.metadata_json?.series_number;
  return typeof series === "number" && Number.isInteger(series) ? series : null;
}

// Most recent sale price (XCH) from the NFT's events — a value anchor when the collection has no
// listed floor (common on Chia). Takes the last event carrying a positive xch_price.
function lastSalePriceXch(events: MgNftDetail["events"]): number | null {
  let price: number | null = null;
  for (const e of events ?? []) if (typeof e.xch_price === "number" && e.xch_price > 0) price = e.xch_price;
  return price;
}

// Up to `n` most-recent SALE prices (XCH), newest first. Raw chain sale events (type 2) — UNFILTERED by the
// comps wash-defenses, so this is display-only "recent sales", never fed into valuation. Events are
// chronological ascending, so take the tail and reverse.
function recentSalesXch(events: MgNftDetail["events"], n = 3): { priceXch: number }[] {
  const sales: { priceXch: number }[] = [];
  for (const e of events ?? []) {
    if (e?.type === 2 && typeof e.xch_price === "number" && e.xch_price > 0) sales.push({ priceXch: e.xch_price });
  }
  return sales.slice(-n).reverse();
}

// Per-NFT price signal used to derive a COLLECTION floor when the market has no other floor: this
// NFT's most recent sale, else its current ask. Aggregated across a collection's NFTs in service.ts.
export function nftMarketAnchorXch(detail: MgNftDetail): number | null {
  const listing = typeof detail.xch_price === "number" && detail.xch_price > 0 ? detail.xch_price : null;
  return lastSalePriceXch(detail.events) ?? listing;
}

function bestImage(detail: MgNftDetail): string {
  return (
    detail.data?.thumbnail_uri ||
    detail.data?.preview_uri ||
    detail.data?.data_uris?.[0] ||
    ""
  );
}

// % of the collection that shares a given trait value, from the collection's frequency counts.
// MintGarden lowercases both the trait type and value keys.
function traitRarityPercent(
  collection: MgCollection,
  traitType: string,
  value: string | number,
): number | undefined {
  const counts = collection.attributes_frequency_counts;
  const total = collection.nft_count ?? 0;
  if (!counts || total <= 0) return undefined;
  const group = counts[traitType.toLowerCase()];
  if (!group) return undefined;
  const count = group[String(value).toLowerCase()];
  if (typeof count !== "number") return undefined;
  return round((count / total) * 100, 1);
}

export function mapTraits(detail: MgNftDetail): Trait[] {
  const attrs = detail.data?.metadata_json?.attributes ?? [];
  return attrs
    .map((a): Trait | null => {
      if (!a) return null;
      // Accept CHIP-0007 `trait_type` plus the `type` / `name` variants other Chia collections use.
      const rawLabel = a.trait_type ?? a.type ?? a.name;
      if (rawLabel === undefined || rawLabel === null) return null;
      if (a.value === undefined || a.value === null) return null;
      const label = String(rawLabel).trim();
      // Skip non-trait metadata rows some mints stuff into attributes (e.g. a description blob).
      if (!label || label.toLowerCase() === "description") return null;
      const value = a.value as string | number;
      return { trait_type: label, value, rarityPercent: traitRarityPercent(detail.collection, label, value) };
    })
    .filter((t): t is Trait => t !== null);
}

// Traits from a LIST item's inline metadata (present only with include_metadata=true). Same tolerant
// key handling as mapTraits; rarityPercent is filled later by the freq table / seed overlay.
export function mapListItemTraits(item: MgListItem): Trait[] {
  const attrs = item.metadata?.attributes ?? [];
  return attrs
    .map((a): Trait | null => {
      if (!a) return null;
      const rawLabel = a.trait_type ?? a.type ?? a.name;
      if (rawLabel === undefined || rawLabel === null || a.value === undefined || a.value === null) return null;
      const label = String(rawLabel).trim();
      if (!label || label.toLowerCase() === "description") return null;
      return { trait_type: label, value: a.value as string | number };
    })
    .filter((t): t is Trait => t !== null);
}

export function mapCollection(c: MgCollection): CollectionData {
  return {
    slug: c.id, // col1... — stable identifier; live collections key off the chain id, not a name
    name: c.name,
    description: c.description ?? null,
    bannerUrl: c.banner_uri ?? null,
    iconUrl: c.thumbnail_uri ?? null,
    nftCount: c.nft_count ?? 0,
    totalSupply: c.nft_count ?? 0,
    theme: { accent: "#5fce7a" }, // live collections use the platform default until themed
    dexieCollectionId: c.id,
  };
}

// Cache one rank estimator per collection (keyed by id + supply) — building it convolves the whole
// trait distribution, so we do it once and reuse across every held NFT of that collection.
const rankEstimatorCache = new Map<string, RankEstimator | null>();
function getRankEstimator(collection: MgCollection): RankEstimator | null {
  const total = collection.nft_count ?? 0;
  const key = `${collection.id}:${total}`;
  if (!rankEstimatorCache.has(key)) {
    rankEstimatorCache.set(key, buildRankEstimator(collection.attributes_frequency_counts ?? {}, total));
  }
  return rankEstimatorCache.get(key) ?? null;
}

export interface MappedNft {
  nft: NftData;
  collectionId: string;
  collectionName: string;
  collectionFloorXch: number | null;
  totalSupply: number;
}

// Full mapping from an NFT detail, including a live fair-value estimate + deal score.
export function mapDetailToNftData(
  detail: MgNftDetail,
  xchUsdRate = XCH_USD_FALLBACK,
  floorOverrideXch?: number | null,
): MappedNft {
  const collection = detail.collection;
  const totalSupply = collection.nft_count ?? detail.data?.metadata_json?.series_total ?? 0;
  const traits = mapTraits(detail);
  // Prefer the indexer's exact OpenRarity rank. When absent (many Chia collections), estimate it
  // ourselves from the collection's trait-frequency table so the NFT can still be tiered/sorted.
  const indexerRank = parseRank(detail.openrarity_rank);
  let rarityRank = indexerRank;
  let rankEstimated = false;
  if (rarityRank === null) {
    const estimated = getRankEstimator(collection)?.rankOf(traits) ?? null;
    if (estimated !== null) { rarityRank = estimated; rankEstimated = true; }
  }
  // Last-resort: collections with no indexer rank AND no frequency table (e.g. TCG sets) often carry
  // the creator's own declared rarity as a trait. Honor it so the card still tiers/sorts. ≈ flagged.
  if (rarityRank === null) {
    const declared = declaredRarityTier(traits);
    if (declared) {
      const r = syntheticRankForTier(declared, totalSupply);
      if (r !== null) { rarityRank = r; rankEstimated = true; }
    }
  }
  // Prefer a resolved floor (e.g. a live Dexie ask) passed by the caller; fall back to MintGarden's
  // own floor_price. Dexie is the platform's designated floor source (ARCHITECTURE.md §7 market layer).
  const mgFloor = typeof collection.floor_price === "number" ? collection.floor_price : null;
  const listingXch = typeof detail.xch_price === "number" && detail.xch_price > 0 ? detail.xch_price : null;
  // The base floor is resolved at the COLLECTION level by the caller (service.ts) and passed in, so
  // every card in a collection shares one base and only the rarity premium varies between them.
  // Per-NFT sale/listing prices feed that collection floor via nftMarketAnchorXch — they never set an
  // individual card's base, which is what made sibling cards' values look wildly inconsistent.
  const floorXch = floorOverrideXch ?? mgFloor;

  // Special/collectible mint number -> badge + desirability value bump (VALUATION.md Part 2).
  const collectible = collectibleNumber(parseMintNumber(detail), totalSupply);

  const fairValue: FairValueEstimate | null =
    floorXch !== null
      ? estimateFairValue({
          floorXch,
          rarityRank,
          totalSupply,
          desirabilityWeight: collectible?.weight ?? 0,
          xchUsdRate,
        })
      : null;

  const listing: ListingData | null =
    listingXch !== null ? { priceXch: listingXch, priceUsd: round(listingXch * xchUsdRate, 2) } : null;

  const rankPercentile = rarityRank && totalSupply > 0 ? (rarityRank / totalSupply) * 100 : null;
  const rarityScore = rankPercentile !== null ? round(100 - rankPercentile, 1) : null;

  const dealScore =
    fairValue && listing ? computeDealScore(fairValue.totalEstimate, listing.priceXch) : null;

  const nft: NftData = {
    id: detail.id,
    launcherId: detail.encoded_id,
    collectionSlug: collection.id,
    name: detail.data?.metadata_json?.name ?? detail.encoded_id,
    imageUrl: bestImage(detail),
    traits,
    rarityRank,
    rankEstimated,
    currentOwnerAddress: detail.owner_address?.encoded_id ?? null,
    recentSales: ((r) => (r.length ? r : null))(recentSalesXch(detail.events)),
    fairValue,
    rarityScore,
    listing,
    dealScore,
    collectible: collectible ? { tier: collectible.tier, label: collectible.label } : null,
  };

  return { nft, collectionId: collection.id, collectionName: collection.name, collectionFloorXch: floorXch, totalSupply };
}

// FAST mapping for progressive binder loading: a card built from a holdings LIST item + its
// collection metadata (supply/floor), WITHOUT the per-NFT detail fetch. Gives image, name, listing,
// the indexer's rank (when present) and a floor-anchored value immediately; traits + our own
// estimated rank are filled in later by the full mapper (mapDetailToNftData) during enrichment.
export interface MappedCard {
  nft: NftData;
  collectionId: string;
  collectionName: string;
  totalSupply: number;
}

export function mapListItemToCard(
  item: MgListItem,
  collection: MgCollection | undefined,
  floorXch: number | null,
  xchUsdRate = XCH_USD_FALLBACK,
): MappedCard {
  const rarityRank = parseRank(item.openrarity_rank);
  const totalSupply = collection?.nft_count ?? 0;
  const listingXch = typeof item.price === "number" && item.price > 0 ? item.price : null;
  const nameNum = (item.name ?? "").match(/#?(\d+)\s*$/);
  const mintNumber = nameNum ? parseInt(nameNum[1], 10) : null;
  const collectible = collectibleNumber(mintNumber, totalSupply);

  const fairValue: FairValueEstimate | null =
    floorXch !== null
      ? estimateFairValue({
          floorXch,
          rarityRank,
          totalSupply,
          desirabilityWeight: collectible?.weight ?? 0,
          xchUsdRate,
        })
      : null;

  const listing: ListingData | null =
    listingXch !== null ? { priceXch: listingXch, priceUsd: round(listingXch * xchUsdRate, 2) } : null;

  const rankPercentile = rarityRank && totalSupply > 0 ? (rarityRank / totalSupply) * 100 : null;
  const rarityScore = rankPercentile !== null ? round(100 - rankPercentile, 1) : null;
  const dealScore =
    fairValue && listing ? computeDealScore(fairValue.totalEstimate, listing.priceXch) : null;

  const nft: NftData = {
    id: item.id,
    launcherId: item.encoded_id,
    collectionSlug: item.collection_id,
    name: item.name,
    imageUrl: item.thumbnail_uri ?? "",
    traits: mapListItemTraits(item),
    rarityRank,
    rankEstimated: false,
    currentOwnerAddress: item.owner_address_encoded_id ?? null,
    fairValue,
    rarityScore,
    listing,
    dealScore,
    collectible: collectible ? { tier: collectible.tier, label: collectible.label } : null,
  };

  return {
    nft,
    collectionId: item.collection_id,
    collectionName: item.collection_name ?? collection?.name ?? item.collection_id,
    totalSupply,
  };
}

// Slim mapping from a list item (no traits/floor available) — used for collection browsing.
export function mapListItemToNftData(item: MgListItem, xchUsdRate = XCH_USD_FALLBACK): NftData {
  const rarityRank = parseRank(item.openrarity_rank);
  const listing: ListingData | null =
    typeof item.price === "number" && item.price > 0
      ? { priceXch: item.price, priceUsd: round(item.price * xchUsdRate, 2) }
      : null;
  return {
    id: item.id,
    launcherId: item.encoded_id,
    collectionSlug: item.collection_id,
    name: item.name,
    imageUrl: item.thumbnail_uri ?? "",
    traits: mapListItemTraits(item),
    rarityRank,
    currentOwnerAddress: item.owner_address_encoded_id ?? null,
    fairValue: null,
    rarityScore: null,
    listing,
    dealScore: null,
  };
}

// MintGarden collection -> discovery card.
export function mapCollectionSummary(c: MgCollection): CollectionSummary {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    imageUrl: c.thumbnail_uri ?? null,
    bannerUrl: c.banner_uri ?? null,
    totalSupply: c.nft_count ?? 0,
    floorXch: typeof c.floor_price === "number" ? c.floor_price : null,
    volumeXch: typeof c.volume === "number" ? c.volume : null,
    tradeCount: typeof c.trade_count === "number" ? c.trade_count : null,
    creatorName: c.creator?.name ?? null,
    verified: c.creator?.verification_state === 1,
  };
}
