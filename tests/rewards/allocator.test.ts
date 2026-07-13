import { test } from "node:test";
import assert from "node:assert/strict";
import { rarityWeight, weighHoldings, allocateDrip, type SnapshotNft } from "../../src/lib/rewards/allocator";

test("rarityWeight: rarer ranks weigh more; commons sit at the base 1; unknown -> base", () => {
  const supply = 1000;
  const grail = rarityWeight(1, supply);
  const mid = rarityWeight(150, supply);
  const common = rarityWeight(900, supply); // percentile 90 -> premium 0 -> base
  assert.ok(grail > mid, "rank 1 should weigh more than rank 150");
  assert.ok(mid > common, "a rarer piece should weigh more than a common");
  assert.equal(common, 1, "a common sits at the base weight");
  assert.equal(rarityWeight(0, supply), 1, "unknown rank -> base");
  assert.equal(rarityWeight(5, 0), 1, "unknown supply -> base");
});

test("allocateDrip: proportional to weight, aggregates per wallet, EXACTLY solvent", () => {
  // alice holds two NFTs (weights 3 and 1 -> 4), bob one (weight 1). Total shares = 5. Drip 1000.
  const holdings = [
    { wallet: "alice", weight: 3 },
    { wallet: "alice", weight: 1 },
    { wallet: "bob", weight: 1 },
  ];
  const r = allocateDrip(holdings, BigInt(1000));
  assert.equal(r.holderCount, 2);
  assert.equal(r.nftCount, 3);
  const alice = r.wallets.find((w) => w.wallet === "alice")!;
  const bob = r.wallets.find((w) => w.wallet === "bob")!;
  assert.equal(alice.nftCount, 2);
  assert.equal(alice.tokenUnits, BigInt(800)); // 4/5 of 1000
  assert.equal(bob.tokenUnits, BigInt(200));   // 1/5 of 1000
  assert.equal(alice.tokenUnits + bob.tokenUnits, BigInt(1000));
  assert.equal(r.solvent, true);
  assert.equal(r.wallets[0].wallet, "alice"); // sorted desc
});

test("allocateDrip: integer-division dust goes to the largest holder; total == drip exactly", () => {
  // three equal-weight wallets, drip 100 -> 33 each + 1 dust to the largest-share wallet.
  const holdings = [
    { wallet: "a", weight: 1 },
    { wallet: "b", weight: 1 },
    { wallet: "c", weight: 1 },
  ];
  const r = allocateDrip(holdings, BigInt(100));
  const sum = r.wallets.reduce((s, w) => s + w.tokenUnits, BigInt(0));
  assert.equal(sum, BigInt(100), "must distribute every unit");
  assert.equal(r.solvent, true);
  const maxUnits = r.wallets.map((w) => w.tokenUnits).reduce((m, x) => (x > m ? x : m), BigInt(0));
  assert.equal(maxUnits, BigInt(34)); // one wallet gets the dust
});

test("allocateDrip: zero drip / no holders is trivially solvent, no allocation", () => {
  assert.equal(allocateDrip([{ wallet: "a", weight: 2 }], BigInt(0)).solvent, true);
  assert.equal(allocateDrip([{ wallet: "a", weight: 2 }], BigInt(0)).wallets[0].tokenUnits, BigInt(0));
  const empty = allocateDrip([], BigInt(1000));
  assert.equal(empty.holderCount, 0);
  assert.equal(empty.wallets.length, 0);
  assert.equal(empty.solvent, true);
});

test("rarity-weighted end-to-end: the wallet holding rarer pieces drips more; solvent", () => {
  const supply = 1000;
  const snap: SnapshotNft[] = [
    { wallet: "whale", rank: 2, supply },    // grail
    { wallet: "whale", rank: 800, supply },  // common
    { wallet: "min", rank: 850, supply },    // common
  ];
  const r = allocateDrip(weighHoldings(snap), BigInt(1_000_000));
  const whale = r.wallets.find((w) => w.wallet === "whale")!;
  const min = r.wallets.find((w) => w.wallet === "min")!;
  assert.ok(whale.tokenUnits > min.tokenUnits, "the rarer-holding wallet drips more");
  assert.equal(whale.tokenUnits + min.tokenUnits, BigInt(1_000_000));
  assert.equal(r.solvent, true);
});
