import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeInto, pruneTags, TAG_RETENTION_MS, type TagStore } from "../../src/lib/rewards/tagStore";
import type { RawSale } from "../../src/lib/rewards/detect";

const raw = (offerId: string, nftId = "n", priceXch = 100, soldAt = 1): RawSale => ({ offerId, nftId, priceXch, soldAt });

test("freezeInto: a COLD valuation (null) does NOT stamp — retries later", () => {
  const r = freezeInto({}, [raw("o1")], () => null, 1000);
  assert.equal(r.changed, false);
  assert.deepEqual(r.store, {});
  assert.equal(r.fvOf(raw("o1")), null);
});

test("freezeInto: a resolved valuation stamps once and FREEZES (later model change ignored)", () => {
  const first = freezeInto({}, [raw("o1")], () => 200, 1000);
  assert.equal(first.changed, true);
  assert.equal(first.fvOf(raw("o1")), 200);
  // second run, model now says 999 — the frozen 200 must stand
  const second = freezeInto(first.store, [raw("o1")], () => 999, 2000);
  assert.equal(second.changed, false, "already stamped -> no change");
  assert.equal(second.fvOf(raw("o1")), 200, "frozen value unchanged");
});

test("freezeInto: distinct sales (offerIds) freeze independently; unchanged when all stamped", () => {
  const s1 = freezeInto({}, [raw("o1"), raw("o2")], (r) => (r.offerId === "o1" ? 50 : 300), 1000);
  assert.equal(Object.keys(s1.store).length, 2);
  assert.equal(s1.fvOf(raw("o1")), 50);
  assert.equal(s1.fvOf(raw("o2")), 300);
  const again = freezeInto(s1.store, [raw("o1"), raw("o2")], () => 1, 2000);
  assert.equal(again.changed, false);
});

test("pruneTags: drops entries older than retention, keeps recent", () => {
  const now = 1_000_000_000_000;
  const store: TagStore = {
    old: { fvXch: 1, priceXch: 1, capturedAt: now - TAG_RETENTION_MS - 1, soldAt: 0 },
    fresh: { fvXch: 1, priceXch: 1, capturedAt: now - 1000, soldAt: 0 },
  };
  const p = pruneTags(store, now);
  assert.equal(p.changed, true);
  assert.ok(!("old" in p.store));
  assert.ok("fresh" in p.store);
  assert.equal(pruneTags(p.store, now).changed, false); // nothing to prune -> no change
});
