import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDetailToNftData, mapTraits } from "../../src/lib/data-sources/mintgarden/map";
import type { MgNftDetail } from "../../src/lib/data-sources/mintgarden/types";

// Compact but faithful slice of a real GET /nfts/{id} response (Chia Gods #181).
const DETAIL: MgNftDetail = {
  id: "7f5f19b474d68fe920bf6c36e59a3469b270105ae777a6a4d68f27216f3d63c8",
  encoded_id: "nft10a03ndr56687jg9ldsmwtx35dxe8qyz6uam6dfxk3unjzmeav0yqfwmcer",
  data: {
    thumbnail_uri: "https://assets.mainnet.mintgarden.io/thumbnails/abc_512.webp",
    preview_uri: "https://assets.mainnet.mintgarden.io/thumbnails/abc.webp",
    data_uris: ["https://ipfs.mintgarden.io/ipfs/x/181.png"],
    metadata_json: {
      name: "Chia Gods #181",
      series_total: 250,
      series_number: 181,
      attributes: [
        { value: "Sky Peaks", trait_type: "Background" },
        { value: "Green Suit", trait_type: "Outfit" },
        { value: "Black", trait_type: "Hair Color" },
      ],
    },
  },
  xch_price: 1.5,
  owner_address: { id: "15b0", encoded_id: "xch1zkc096dg5ee5j8gl3gxl7acxpk42zdyar2lra8r034m35c0yy8fqlhsyxh" },
  openrarity_rank: "72",
  collection: {
    id: "col1zpqtfv9yynf0q95sg27n44r25vphg6n8rlzn6v3j6r8mm52zjvlq8hcqru",
    name: "Chia Gods",
    description: "Divine.",
    thumbnail_uri: "https://assets.mainnet.mintgarden.io/thumbnails/col.webp",
    banner_uri: "https://assets.mainnet.mintgarden.io/thumbnails/col_banner.webp",
    nft_count: 250,
    floor_price: 1.0,
    attributes_frequency_counts: {
      background: { "sky peaks": 28 },
      outfit: { "green suit": 42 },
      "hair color": { black: 150 },
    },
  },
};

test("trait rarity % is computed from collection frequency counts", () => {
  const traits = mapTraits(DETAIL);
  assert.equal(traits.length, 3);
  const bg = traits.find((t) => t.trait_type === "Background")!;
  assert.equal(bg.value, "Sky Peaks");
  assert.equal(bg.rarityPercent, 11.2); // 28 / 250
});

test("detail maps to NftData with rank, owner, image, listing", () => {
  const { nft } = mapDetailToNftData(DETAIL, 10);
  assert.equal(nft.launcherId, DETAIL.encoded_id);
  assert.equal(nft.name, "Chia Gods #181");
  assert.equal(nft.imageUrl, "https://assets.mainnet.mintgarden.io/thumbnails/abc_512.webp");
  assert.equal(nft.collectionSlug, DETAIL.collection.id);
  assert.equal(nft.rarityRank, 72);
  assert.equal(nft.currentOwnerAddress, "xch1zkc096dg5ee5j8gl3gxl7acxpk42zdyar2lra8r034m35c0yy8fqlhsyxh");
  assert.equal(nft.listing?.priceXch, 1.5);
  assert.equal(nft.listing?.priceUsd, 15);
});

test("detail carries a live fair-value estimate + deal score + collection meta", () => {
  const mapped = mapDetailToNftData(DETAIL, 10);
  assert.equal(mapped.collectionName, "Chia Gods");
  assert.equal(mapped.totalSupply, 250);
  assert.equal(mapped.collectionFloorXch, 1.0);
  assert.ok(mapped.nft.fairValue);
  assert.equal(mapped.nft.fairValue!.totalEstimate, 1.21);
  assert.ok(mapped.nft.dealScore);
});

test("missing floor => fairValue null but NFT still maps", () => {
  const noFloor: MgNftDetail = { ...DETAIL, collection: { ...DETAIL.collection, floor_price: null } };
  const { nft } = mapDetailToNftData(noFloor, 10);
  assert.equal(nft.fairValue, null);
  assert.equal(nft.rarityRank, 72);
});

test("a resolved floor override (e.g. Dexie) replaces MintGarden's floor in valuation", () => {
  const { nft } = mapDetailToNftData(DETAIL, 10, 2.0); // override floor 1.0 -> 2.0
  assert.equal(nft.fairValue?.floorValue, 2.0);
  // rarity premium scales with floor: 2.0 * 0.15 = 0.30
  assert.equal(nft.fairValue?.rarityPremium, 0.3);
});
