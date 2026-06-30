import { test } from "node:test";
import assert from "node:assert/strict";
import { collectibleNumber } from "../../src/lib/rarity/collectibleNumbers";

function tierLabel(n: number, size = 10000, custom?: number) {
  const r = collectibleNumber(n, size, custom);
  return r ? `${r.tier}:${r.label}` : "none";
}

test("grails (tier 1)", () => {
  assert.equal(tierLabel(1), "1:Genesis");
  assert.equal(tierLabel(69), "1:Nice");
  assert.equal(tierLabel(420), "1:Blaze");
  assert.equal(tierLabel(1337), "1:Leet");
  assert.equal(tierLabel(7777), "1:Jackpot");
  assert.equal(tierLabel(8888), "1:Lucky 8s");
});

test("finale = last mint, beats lower-tier matches", () => {
  assert.equal(tierLabel(500, 500), "1:Finale");
  assert.equal(tierLabel(1000, 1000), "1:Finale"); // finale (1) beats milestone (2)
  assert.equal(tierLabel(1000, 5000), "2:Milestone"); // not the last -> milestone
});

test("legendary / rare tiers", () => {
  assert.equal(collectibleNumber(777)!.tier, 2);
  assert.equal(collectibleNumber(42)!.tier, 2);
  assert.equal(collectibleNumber(1234)!.tier, 2); // straight beats angel
  assert.equal(collectibleNumber(4321)!.tier, 2);
  assert.equal(collectibleNumber(100)!.tier, 3);
  assert.equal(collectibleNumber(77)!.tier, 3);
  assert.equal(collectibleNumber(404)!.tier, 3);
  assert.equal(collectibleNumber(2048)!.tier, 3);
  assert.equal(collectibleNumber(1212)!.tier, 3);
  assert.equal(collectibleNumber(181)!.tier, 3); // palindrome
});

test("fun finds (tier 4) and non-special", () => {
  assert.equal(collectibleNumber(50)!.tier, 4); // early mint
  assert.equal(collectibleNumber(200)!.tier, 4); // round hundred
  assert.equal(collectibleNumber(64)!.tier, 4); // power of two
  assert.equal(collectibleNumber(173), null); // not special
  assert.equal(collectibleNumber(0), null);
  assert.equal(collectibleNumber(null), null);
});

test("custom collection number is a grail; weights match tier", () => {
  const c = collectibleNumber(88, 1000, 88);
  assert.equal(c!.tier, 1);
  assert.equal(c!.label, "Collector's Number");
  assert.equal(collectibleNumber(1)!.weight, 0.4);
  assert.equal(collectibleNumber(50)!.weight, 0.02); // tier 4 = small 'fun' premium
});
