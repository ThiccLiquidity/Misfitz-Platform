import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyRoyalty, reconcileSale, partitionVerified, type ChainVerifyConfig } from "../../src/lib/rewards/chainVerify";
import type { ChainSaleSpend } from "../../src/lib/rewards/chainProvider";
import { toSale, XCH, type RawSale } from "../../src/lib/rewards/detect";

const A = (c: string) => "xch1" + c.repeat(58);
const CREATOR = A("c");
const cfg: ChainVerifyConfig = { creatorAddress: CREATOR, royaltyBps: 1000, minRoyaltyBps: 990, minBlockDepth: 32, maxPriceDriftBps: 500 };
const sale = toSale({ offerId: "s1", nftId: "n1", priceXch: 100, soldAt: 1, buyer: A("a"), seller: A("b") } as RawSale, null);

const goodSpend = (over: Partial<ChainSaleSpend> = {}): ChainSaleSpend => ({
  nftLauncherId: "n1", buyer: A("a"), seller: A("b"),
  payments: [{ toAddress: CREATOR, amountMojos: XCH(10) }, { toAddress: A("b"), amountMojos: XCH(90) }],
  priceMojos: XCH(100), paidInXch: true, nftCountInSpend: 1,
  coinId: "coin1", spendId: "spend1", blockIndex: 100, blockDepth: 64, timestamp: 1, ...over,
});

test("verifyRoyalty: valid 10% royalty to creator -> verified with ACTUAL royalty/provenance", () => {
  const v = verifyRoyalty(goodSpend(), sale, cfg);
  assert.equal(v.verified, true);
  assert.equal(v.royaltyMojos, XCH(10));
  assert.equal(v.buyer, A("a"));
  assert.equal(v.coinId, "coin1");
});

test("verifyRoyalty: fails closed on each bad condition", () => {
  assert.equal(verifyRoyalty(null, sale, cfg).reason, "no-spend-found");
  assert.equal(verifyRoyalty(goodSpend({ nftLauncherId: "other" }), sale, cfg).reason, "nft-mismatch");
  assert.equal(verifyRoyalty(goodSpend({ paidInXch: false }), sale, cfg).reason, "not-xch");
  assert.equal(verifyRoyalty(goodSpend({ nftCountInSpend: 2 }), sale, cfg).reason, "multi-nft-spend");
  const shallow = verifyRoyalty(goodSpend({ blockDepth: 5 }), sale, cfg);
  assert.equal(shallow.reason, "insufficient-depth");
  assert.equal(shallow.retryable, true);
  assert.equal(verifyRoyalty(goodSpend({ payments: [{ toAddress: A("z"), amountMojos: XCH(100) }] }), sale, cfg).reason, "royalty-missing");
  assert.equal(verifyRoyalty(goodSpend({ payments: [{ toAddress: CREATOR, amountMojos: XCH(1) }, { toAddress: A("b"), amountMojos: XCH(99) }] }), sale, cfg).reason, "royalty-short");
  assert.equal(verifyRoyalty(goodSpend({ priceMojos: XCH(200), payments: [{ toAddress: CREATOR, amountMojos: XCH(20) }, { toAddress: A("b"), amountMojos: XCH(180) }] }), sale, cfg).reason, "price-drift");
});

test("reconcileSale replaces assumed fields with chain truth; keeps the frozen tag", () => {
  const v = verifyRoyalty(goodSpend({ payments: [{ toAddress: CREATOR, amountMojos: XCH(12) }, { toAddress: A("b"), amountMojos: XCH(88) }] }), sale, cfg);
  const r = reconcileSale(sale, v);
  assert.equal(r.royaltyMojos, XCH(12)); // ACTUAL, not assumed 10
  assert.equal(r.coinId, "coin1");
  assert.equal(r.bonusWinner, sale.bonusWinner); // tag frozen
});

test("partitionVerified: splits verified / retry / rejected", () => {
  const results = [
    { shadow: sale, v: verifyRoyalty(goodSpend(), sale, cfg) },                          // verified
    { shadow: sale, v: verifyRoyalty(goodSpend({ blockDepth: 1 }), sale, cfg) },          // retry
    { shadow: sale, v: verifyRoyalty(goodSpend({ payments: [] }), sale, cfg) },           // rejected
  ];
  const p = partitionVerified(results);
  assert.equal(p.verified.length, 1);
  assert.equal(p.retry.length, 1);
  assert.equal(p.rejected.length, 1);
  assert.equal(p.rejected[0].reason, "royalty-missing");
});

import { verifySales } from "../../src/lib/rewards/chainVerify";

test("verifyRoyalty: malformed provider input fails CLOSED, never throws", () => {
  assert.equal(verifyRoyalty({ ...goodSpend(), blockDepth: undefined as unknown as number }, sale, cfg).reason, "malformed-spend");
  assert.equal(verifyRoyalty({ ...goodSpend(), priceMojos: 100 as unknown as bigint }, sale, cfg).reason, "malformed-spend");
  assert.equal(verifyRoyalty({ ...goodSpend(), payments: [{ toAddress: CREATOR, amountMojos: 10 as unknown as bigint }] }, sale, cfg).reason, "malformed-spend");
});

test("verifyRoyalty: creator as buyer/seller is excluded (no principal-as-royalty exploit)", () => {
  assert.equal(verifyRoyalty(goodSpend({ seller: CREATOR, payments: [{ toAddress: CREATOR, amountMojos: XCH(100) }] }), sale, cfg).reason, "creator-counterparty");
  assert.equal(verifyRoyalty(goodSpend({ buyer: CREATOR }), sale, cfg).reason, "creator-counterparty");
});

test("verifyRoyalty: nftCountInSpend must be EXACTLY 1 (missing/0 is not clean)", () => {
  assert.equal(verifyRoyalty(goodSpend({ nftCountInSpend: 0 }), sale, cfg).reason, "multi-nft-spend");
});

test("verifySales: validates config, derives depth from peak (not provider-trusted)", async () => {
  const provider = { peakHeight: async () => 200, findSaleSpend: async () => goodSpend({ blockIndex: 190, blockDepth: 0 }) };
  const p = await verifySales([sale], provider, cfg); // peak200 - idx190 = depth10 < 32 -> retry
  assert.equal(p.retry.length, 1);
  await assert.rejects(() => verifySales([sale], provider, { ...cfg, creatorAddress: "nope" }));
  await assert.rejects(() => verifySales([sale], provider, { ...cfg, minBlockDepth: 0 }));
  await assert.rejects(() => verifySales([sale], provider, { ...cfg, minRoyaltyBps: 0 }));
});

import { assertVerifiedSales } from "../../src/lib/rewards/chainVerify";

test("assertVerifiedSales: passes reconciled sales, throws on a shadow (unverified) sale", () => {
  const verified = reconcileSale(sale, verifyRoyalty(goodSpend(), sale, cfg));
  assert.doesNotThrow(() => assertVerifiedSales([verified]));
  assert.throws(() => assertVerifiedSales([sale]), /not chain-verified/); // shadow sale has no spendId
});

test("verifyRoyalty: empty provenance ids -> malformed-spend (per-sale reject, not a whole-epoch throw)", () => {
  assert.equal(verifyRoyalty(goodSpend({ spendId: "" }), sale, cfg).reason, "malformed-spend");
  assert.equal(verifyRoyalty(goodSpend({ coinId: "" }), sale, cfg).reason, "malformed-spend");
});
