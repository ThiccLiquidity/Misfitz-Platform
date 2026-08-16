import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpGetBlob, tmpPutBlob, tmpEligible } from "../../src/lib/db/tmpBlobCache";

const KEY = "slimlist2:col1tmpcachetest";
const fileFor = (key: string) =>
  path.join("/tmp", "tf-blobs", `${key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48)}.${createHash("sha256").update(key).digest("hex").slice(0, 16)}.blob`);

// The allowlist is the whole safety argument for reading local-first. Anything used for cross-instance
// COORDINATION must never be served from a per-instance copy: a stale local read there is a correctness
// bug, not just a slow path.
test("only pure caches are eligible", () => {
  for (const k of ["slimlist2:col1a", "rarityfreq:col1a", "vidx:col1a", "sales:col1a", "holdings3:xch1a", "pwallet:abc", "tang:collections:v1"]) {
    assert.ok(tmpEligible(k), `${k} should be eligible`);
  }
  for (const k of [
    "slimscan:col1a",        // roster resume checkpoint — a stale copy re-pages ground already covered
    "holdscan:xch1a",        // wallet resume checkpoint — same
    "comps:col1a",           // one read site is the build-lock LOSER picking up the winner's write
    "rw:tags:v1:col1a",      // payout-bearing read-modify-write
    "rw:lpobs:v1:col1a:3",
    "rw:lptenure:v1:col1a",
  ]) {
    assert.ok(!tmpEligible(k), `${k} must NOT be eligible`);
  }
});

test("a large payload round-trips byte-exact", async () => {
  const payload = "A".repeat(2_400_000); // a real gzipped 10k roster is about this size
  await tmpPutBlob(KEY, payload, 2_592_000);
  assert.equal(await tmpGetBlob(KEY, 30 * 24 * 3_600_000), payload);
});

test("freshness matches the shared tiers (fresh iff age < ttlMs)", async () => {
  await tmpPutBlob(KEY, "PAYLOAD", 3600);
  assert.equal(await tmpGetBlob(KEY, 60_000), "PAYLOAD");
  assert.equal(await tmpGetBlob(KEY, 0), null, "ttl 0 must be stale, same as redisGet");
});

test("a missing key on a cold instance is a clean miss", async () => {
  assert.equal(await tmpGetBlob("slimlist2:col1neverwritten", 60_000), null);
});

test("the tiny-exSeconds delete idiom removes the local copy", async () => {
  // Callers clear a checkpoint by writing with exSeconds <= 5. If the local tier ignored that it would
  // resurrect state the caller just deleted.
  await tmpPutBlob(KEY, "PAYLOAD", 3600);
  await tmpPutBlob(KEY, "PAYLOAD", 1);
  assert.equal(await tmpGetBlob(KEY, 60_000), null);
});

test("a truncated file is a miss, not short data", async () => {
  // Vercel runs invocations concurrently in one instance, so a reader can meet a writer. writeFile
  // truncates in place, and a truncated-but-valid gzip member would return SHORT JSON rather than throw —
  // which is why writes go through a rename and the header carries the length.
  await tmpPutBlob(KEY, "PAYLOAD_THAT_IS_LONG_ENOUGH_TO_CUT", 3600);
  const f = fileFor(KEY);
  const raw = await fs.readFile(f, "utf8");
  await fs.writeFile(f, raw.slice(0, raw.length - 5));
  assert.equal(await tmpGetBlob(KEY, 60_000), null);
});

test("a header naming a different key is a miss", async () => {
  await tmpPutBlob(KEY, "PAYLOAD", 3600);
  await fs.writeFile(fileFor(KEY), `${JSON.stringify({ k: "slimlist2:SOMETHING_ELSE", t: Date.now(), len: 3 })}\nabc`);
  assert.equal(await tmpGetBlob(KEY, 60_000), null);
});

test("an unwritable or absent /tmp never throws", async () => {
  await assert.doesNotReject(() => tmpPutBlob("slimlist2:col1x", "x", 60));
  await assert.doesNotReject(async () => { await tmpGetBlob("slimlist2:col1x", 60_000); });
});
