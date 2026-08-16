import { test } from "node:test";
import assert from "node:assert/strict";
import { scaledRankOf, type CollectionFrequency } from "../../src/lib/rarity/collectionFrequency";

// Build a CollectionFrequency whose rankById holds ranks 1..M against ids "n1".."nM".
function freq(M: number, complete = true): CollectionFrequency {
  const rankById: Record<string, number> = {};
  for (let r = 1; r <= M; r++) rankById[`n${r}`] = r;
  return { freq: {}, total: M, rankById, complete } as unknown as CollectionFrequency;
}

function labels(M: number, supply: number): (number | null)[] {
  const f = freq(M);
  const out: (number | null)[] = [];
  for (let r = 1; r <= M; r++) out.push(scaledRankOf(f, `n${r}`, supply));
  return out;
}

// REGRESSION: the float form `((r - 0.5) / M) * supply` is not the identity at M === supply.
// ((2 - 0.5) / 10000) * 10000 === 1.4999999999999998 -> rounds to 1, so rank 1 was emitted twice and
// rank 2 never. That is the live "#1 and #3 render, #2 is missing" bug. 573 of 10000 ranks were lost.
test("M === supply is an exact identity (no lost ranks)", () => {
  for (const n of [10, 100, 999, 10_000]) {
    assert.deepEqual(labels(n, n), Array.from({ length: n }, (_, i) => i + 1), `supply=${n}`);
  }
});

test("rank 2 exists for a full 10k collection", () => {
  const l = labels(10_000, 10_000);
  assert.equal(l[0], 1);
  assert.equal(l[1], 2);
  assert.equal(l[2], 3);
});

test("scaled labels stay strictly increasing and in range when M < supply", () => {
  const supply = 10_000;
  for (const M of [9800, 5000, 3333, 250]) {
    const l = labels(M, supply) as number[];
    assert.equal(new Set(l).size, M, `M=${M} must yield M distinct labels`);
    for (let i = 1; i < l.length; i++) assert.ok(l[i] > l[i - 1], `M=${M} not increasing at ${i}`);
    assert.ok(l[0] >= 1 && l[l.length - 1] <= supply, `M=${M} out of range`);
  }
});

test("an incomplete tally is never scaled", () => {
  assert.equal(scaledRankOf(freq(500, false), "n1", 10_000), null);
});

test("unknown id and degenerate inputs return null", () => {
  assert.equal(scaledRankOf(freq(10), "missing", 100), null);
  assert.equal(scaledRankOf(freq(10), "n1", 0), null);
});
