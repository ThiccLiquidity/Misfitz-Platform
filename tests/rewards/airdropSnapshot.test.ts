import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeAirdropSnapshot, verifyFrozenSnapshot, hashHolders } from "../../src/lib/rewards/airdropSnapshot";
import type { SnapshotNft } from "../../src/lib/rewards/allocator";

const holders: SnapshotNft[] = [
  { wallet: "xch1B", rank: 2, supply: 100 },
  { wallet: "xch1a", rank: 1, supply: 100 },
];

test("snapshot hash is order-independent + case-normalized", () => {
  const h1 = hashHolders(holders);
  const h2 = hashHolders([...holders].reverse());
  const h3 = hashHolders(holders.map((h) => ({ ...h, wallet: h.wallet.toUpperCase() })));
  assert.equal(h1, h2, "order must not change the hash");
  assert.equal(h1, h3, "case must not change the hash");
});

test("freeze produces a verifiable snapshot; tampering breaks verification", () => {
  const snap = freezeAirdropSnapshot("col1misfitz", holders);
  assert.equal(snap.version, 1);
  assert.equal(snap.holderNftCount, 2);
  assert.equal(verifyFrozenSnapshot(snap), true);

  const tampered = { ...snap, holders: [...snap.holders, { wallet: "xch1evil", rank: 3, supply: 100 }] };
  assert.equal(verifyFrozenSnapshot(tampered), false, "adding a recipient must fail the hash");

  assert.equal(verifyFrozenSnapshot(null), false);
  assert.equal(verifyFrozenSnapshot({ ...snap, hash: "deadbeef" }), false);
});
