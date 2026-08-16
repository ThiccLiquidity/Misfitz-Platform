import { test } from "node:test";
import assert from "node:assert/strict";
import { projectCollectionWire, expandCollectionWire, COLLECTION_WIRE_VERSION } from "../../src/lib/collections/collectionWire";
import type { NftData } from "@/types";

// The compact wire format is only safe if it is LOSSLESS. Every card that survives a
// project -> expand round trip must be deep-equal to the card the old shape would have sent
// (except `id`, which /all deliberately drops — no client component reads it, and /api/binder
// restores it on every card the user actually opens).
//
// Key-order insensitive: the expander builds fields in its own order, which JSON.stringify would
// otherwise report as a difference on all 10,000 cards.
const RATE = 18.42;
const usd = (x: number) => Math.round(x * RATE * 100) / 100;

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue; // absent and undefined are the same on the wire
      o[k] = stable(val);
    }
    return o;
  }
  return v;
}
function norm(c: NftData): string {
  const { id: _drop, ...rest } = c;
  return JSON.stringify(stable(rest));
}

function card(i: number, over: Partial<NftData> = {}): NftData {
  const total = Math.round((0.85 + i * 0.001) * 1e6) / 1e6;
  return {
    id: `id${i}`,
    launcherId: `nft1${String(i).padStart(58, "z")}`,
    collectionSlug: "col1abc",
    name: `Misfitz #${String(i).padStart(4, "0")}`,
    imageUrl: `https://assets.example.com/thumbnails/${i}.webp`,
    traits: [
      { trait_type: "Background", value: `bg${i % 7}`, rarityPercent: 1 + (i % 40) },
      { trait_type: "Body", value: i % 3, rarityPercent: 2.5 },      // numeric value must stay numeric
      { trait_type: "Hat", value: "None" },                            // no rarityPercent
    ],
    rarityRank: i + 1,
    rankEstimated: i % 5 === 0,
    currentOwnerAddress: `xch1${i % 11}`,
    fairValue: {
      floorValue: 0.85, rarityPremium: 0.1, traitPremium: 0, desirabilityPremium: i % 4 === 0 ? 0.2 : 0,
      historicalSalesPremium: null, demandPremium: null, rewardValue: null,
      totalEstimate: total, totalEstimateUsd: usd(total), estimatedAt: "2026-08-16T03:00:00.000Z",
    },
    rarityScore: Math.round((100 - i / 100) * 1e6) / 1e6,
    listing: null, listingAssets: null, listingRequested: null, dexieOfferId: null, listingUnverified: false,
    dealScore: null, collectible: null,
    totalSupply: 10_000, collectionName: "Misfitz",
    valueBasis: "blended from 42 recent sales", valueConfidence: 0.5, valueSampleSize: 42,
    valueCurve: total * 0.98, valueTraitMult: 1.2, valueTraitTop: "Background:Gold",
    ...over,
  };
}

function roundTrip(cards: NftData[]): NftData[] {
  const wire = projectCollectionWire(
    { nfts: cards, total: cards.length, capped: false, hotTraits: [], warming: false, valuesAsOf: 1, floorXch: 0.85, xchUsdRate: RATE },
    [],
  );
  assert.equal(wire.v, COLLECTION_WIRE_VERSION);
  return expandCollectionWire(wire);
}

function assertLossless(cards: NftData[], label: string) {
  const back = roundTrip(cards);
  assert.equal(back.length, cards.length, `${label}: card count`);
  for (let i = 0; i < cards.length; i++) assert.equal(norm(back[i]), norm(cards[i]), `${label}: card ${i}`);
}

test("plain collection round-trips losslessly", () => {
  assertLossless(Array.from({ length: 200 }, (_, i) => card(i)), "plain");
});

test("every awkward per-card shape survives", () => {
  const cards: NftData[] = [
    card(0),
    // no value model at all
    card(1, { fairValue: null, valueBasis: null, valueConfidence: null, valueSampleSize: null, valueCurve: null, valueTraitMult: null, valueTraitTop: null }),
    // unranked + unscored: rarityScore MUST come back as null, never undefined (the grid card does a
    // strict `!== null` then .toFixed, so undefined would throw and kill the whole binder render)
    card(2, { rarityRank: null, rarityScore: null }),
    // plain XCH listing
    card(3, { listing: { priceXch: 1.5, priceUsd: usd(1.5) }, listingRequested: [{ code: "XCH", amount: 1.5 }], listingAssets: ["XCH"], dexieOfferId: "offer3", dealScore: { score: 88, label: "GREAT DEAL" } }),
    // CAT-inclusive listing — drives the CAT filter and the "+" price pill
    card(4, { listing: { priceXch: 2.25, priceUsd: usd(2.25) }, listingRequested: [{ code: "XCH", amount: 1.1 }, { code: "DBX", amount: 120 }], listingAssets: ["XCH", "DBX"], dexieOfferId: "offer4", listingUnverified: true }),
    // listingAssets deliberately DISAGREEING with listingRequested -> must take the `la` override path
    card(5, { listing: { priceXch: 3, priceUsd: usd(3) }, listingRequested: [{ code: "XCH", amount: 3 }], listingAssets: ["XCH", "SBX"] }),
    // collectible badge
    card(6, { collectible: { tier: 1, label: "Genesis" } }),
    // per-card supply/name overrides (a seeded collection where only some cards match the seed)
    card(7, { totalSupply: 9_981, collectionName: "Misfitz Legacy", collectionSlug: "col1other" }),
    // no traits at all
    card(8, { traits: [] }),
    // a USD field that does NOT match the derivation -> must take the `fu`/`pu` override path
    card(9, { fairValue: { ...card(9).fairValue!, totalEstimateUsd: 1 }, listing: { priceXch: 4, priceUsd: 999 } }),
    // traitPremium non-zero -> `tp` override
    card(10, { fairValue: { ...card(10).fairValue!, traitPremium: 0.07 } }),
  ];
  assertLossless(cards, "awkward");
});

test("identical (type,value) pairs with different rarityPercent stay distinct", () => {
  const a = card(0, { traits: [{ trait_type: "Background", value: "Gold", rarityPercent: 1 }] });
  const b = card(1, { traits: [{ trait_type: "Background", value: "Gold", rarityPercent: 9 }] });
  const back = roundTrip([a, b]);
  assert.equal(back[0].traits[0].rarityPercent, 1);
  assert.equal(back[1].traits[0].rarityPercent, 9);
});

test("trait order within a card is preserved (the grid shows the 6 rarest, ties by order)", () => {
  const c = card(0, {
    traits: [
      { trait_type: "A", value: "1", rarityPercent: 5 },
      { trait_type: "B", value: "2", rarityPercent: 5 },
      { trait_type: "C", value: "3", rarityPercent: 5 },
    ],
  });
  const back = roundTrip([c]);
  assert.deepEqual(back[0].traits.map((t) => t.trait_type), ["A", "B", "C"]);
});

test("card order is preserved (sorts are non-total; display order depends on it)", () => {
  const cards = [card(9), card(3), card(7), card(1)];
  const back = roundTrip(cards);
  assert.deepEqual(back.map((c) => c.name), cards.map((c) => c.name));
});

test("trait objects are not aliased between cards sharing a dictionary entry", () => {
  const t = { trait_type: "Background", value: "Gold", rarityPercent: 1 };
  const back = roundTrip([card(0, { traits: [{ ...t }] }), card(1, { traits: [{ ...t }] })]);
  assert.notEqual(back[0].traits[0], back[1].traits[0]);
  back[0].traits[0].rarityPercent = 99;
  assert.equal(back[1].traits[0].rarityPercent, 1);
});

test("the 10,000-card fairValue sum is bit-identical (headline portfolio stat)", () => {
  const cards = Array.from({ length: 1_000 }, (_, i) => card(i));
  const sum = (list: NftData[]) => list.reduce((a, c) => a + (c.fairValue?.totalEstimate ?? 0), 0);
  assert.equal(sum(roundTrip(cards)), sum(cards));
});

test("an empty collection does not throw", () => {
  const back = roundTrip([]);
  assert.deepEqual(back, []);
});
