import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOpenRarityRanks, NONE_VALUE, type RankableNft } from "../../src/lib/rarity/openrarity";

// N=10 collection. bg: C×7, R×2, U×1. "id" is a unique-per-NFT identifier (degenerate, excluded).
function build(): RankableNft[] {
  const nfts: RankableNft[] = [];
  for (let i = 1; i <= 7; i++) {
    nfts.push({ id: `c${i}`, mintNumber: i, traits: [{ trait_type: "bg", value: "C" }, { trait_type: "id", value: `id${i}` }] });
  }
  nfts.push({ id: "r1", mintNumber: 8, traits: [{ trait_type: "bg", value: "R" }, { trait_type: "id", value: "id8" }] });
  nfts.push({ id: "r2", mintNumber: 9, traits: [{ trait_type: "bg", value: "R" }, { trait_type: "id", value: "id9" }] });
  nfts.push({ id: "u1", mintNumber: 10, traits: [{ trait_type: "bg", value: "U" }, { trait_type: "id", value: "id10" }] });
  return nfts;
}

test("rarest trait value ranks #1; rarity follows frequency", () => {
  const ranks = computeOpenRarityRanks(build());
  assert.equal(ranks.length, 10);
  const byId = new Map(ranks.map((r) => [r.id, r]));
  assert.equal(byId.get("u1")!.rank, 1); // U is 1-of-10
  // both R's outrank all C's
  assert.ok(byId.get("r1")!.rank <= 3 && byId.get("r2")!.rank <= 3);
  assert.ok(byId.get("c1")!.rank >= 4);
});

test("ties break by ascending mint number (deterministic)", () => {
  const ranks = computeOpenRarityRanks(build());
  const byId = new Map(ranks.map((r) => [r.id, r]));
  // r1 (mint 8) ranks ahead of r2 (mint 9) on equal score
  assert.ok(byId.get("r1")!.rank < byId.get("r2")!.rank);
});

test("degenerate id trait does not change the ranking", () => {
  const withId = computeOpenRarityRanks(build());
  const withoutId = computeOpenRarityRanks(
    build().map((n) => ({ ...n, traits: n.traits.filter((t) => t.trait_type !== "id") })),
  );
  // u1 is #1 in both; relative order preserved
  assert.equal(withId.find((r) => r.id === "u1")!.rank, 1);
  assert.equal(withoutId.find((r) => r.id === "u1")!.rank, 1);
});

test("missing trait counts as (none) and adds rarity when scarce", () => {
  // Give only u1 a 'hat'; everyone else implicitly has (none).
  const nfts = build();
  nfts.find((n) => n.id === "u1")!.traits.push({ trait_type: "hat", value: "Gold" });
  const ranks = computeOpenRarityRanks(nfts);
  // The 'hat' category exists (9 are NONE, 1 is Gold) -> u1 even rarer, still #1.
  assert.equal(ranks.find((r) => r.id === "u1")!.rank, 1);
  // sanity: NONE_VALUE is the sentinel used internally
  assert.equal(NONE_VALUE, "(none)");
});
