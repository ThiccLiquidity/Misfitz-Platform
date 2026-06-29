import type { CollectionData, FairValueEstimate, ListingData, NftData, Trait } from "@/types";
import { computeDealScore } from "@/lib/rarity/enrich";
import { estimateFairValue } from "@/lib/valuation/estimate";
import { collectibleNumber } from "@/lib/rarity/collectibleNumbers";
import { XCH_USD_FALLBACK } from "@/lib/market/dexie";
import type { MgCollection, MgListItem, MgNftDetail } from "./types";

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

// Mint/edition number for special-number badges: prefer metadata series_number, else parse a
// trailing "#123" from the name. Null when there's no clean number (e.g. 1/1 art).
function parseMintNumber(detail: MgNftDetail): number | null {
  const series = detail.data?.metadata_json?.series_number;
  if (typeof series === "number" && Number.isInteger(series)) return series;
  const name = detail.data?.metadata_json?.name ?? "";
  const m = name.match(/#?(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
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
    .filter((a) => a && a.trait_type !== undefined && a.value !== undefined)
    .map((a) => ({
      trait_type: String(a.trait_type),
      value: a.value,
      rarityPercent: traitRarityPercent(detail.collection, String(a.trait_type), a.value),
    }));
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
  const rarityRank = parseRank(detail.openrarity_rank);
  const traits = mapTraits(detail);
  // Prefer a resolved floor (e.g. a live Dexie ask) passed by the caller; fall back to MintGarden's
  // own floor_price. Dexie is the platform's designated floor source (ARCHITECTURE.md §7 market layer).
  const mgFloor = typeof collection.floor_price === "number" ? collection.floor_price : null;
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
    typeof detail.xch_price === "number" && detail.xch_price > 0
      ? { priceXch: detail.xch_price, priceUsd: round(detail.xch_price * xchUsdRate, 2) }
      : null;

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
    currentOwnerAddress: detail.owner_address?.encoded_id ?? null,
    fairValue,
    rarityScore,
    listing,
    dealScore,
    collectible: collectible ? { tier: collectible.tier, label: collectible.label } : null,
  };

  return { nft, collectionId: collection.id, collectionName: collection.name, collectionFloorXch: floorXch, totalSupply };
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
    traits: [],
    rarityRank,
    currentOwnerAddress: item.owner_address_encoded_id ?? null,
    fairValue: null,
    rarityScore: null,
    listing,
    dealScore: null,
  };
}
