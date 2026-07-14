import { test } from "node:test";
import assert from "node:assert/strict";
import { walletPeelPoints } from "../src/lib/tang/tang";

const BEARS = "col1tezjkmzhnry4uhy3xpg0f2n2twdxy6mdrcsfknt5y845wut5jazqlv80yt"; // 300 pp
const PHUNK = "col1gxu88qkah92znyvgu7erf6kkgvwwedg48s5fyxefxpgx2hc8ftqqa0gfl0"; // 150 pp

test("walletPeelPoints: per-NFT sum across Tang collections; ignores non-Tang; zeros when flag off", () => {
  const nfts = [
    { collectionSlug: BEARS, launcherId: "a" },
    { collectionSlug: BEARS, launcherId: "b" },
    { collectionSlug: PHUNK, launcherId: "c" },
    { collectionSlug: "col1notatangcollection000000000000000000000000000000000000000", launcherId: "d" },
  ];
  process.env.NEXT_PUBLIC_TANG_GANG = "";
  assert.equal(walletPeelPoints(nfts).total, 0); // flag off -> nothing

  process.env.NEXT_PUBLIC_TANG_GANG = "1";
  const r = walletPeelPoints(nfts);
  assert.equal(r.total, 300 + 300 + 150); // 2 bears + 1 phunk, per NFT
  assert.equal(r.tangNftCount, 3);
  assert.equal(r.rows.length, 2);
  const bears = r.rows.find((x) => x.colId === BEARS)!;
  assert.equal(bears.count, 2);
  assert.equal(bears.subtotal, 600);
  assert.equal(r.specialTotal, 0);
});
