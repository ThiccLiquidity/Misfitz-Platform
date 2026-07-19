import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBlobBackend, getActiveBlobBackend, setBlobBackendForTests } from "../../src/lib/db/blobStore";

test("MemoryBlobBackend round-trips a payload", async () => {
  const b = new MemoryBlobBackend();
  await b.putBlob("slimlist2:col1abc", "PAYLOAD_B64", 3600);
  assert.equal(await b.getBlob("slimlist2:col1abc", 60_000), "PAYLOAD_B64");
  assert.equal(await b.getBlob("missing", 60_000), null);
});

test("MemoryBlobBackend enforces ttl on read", async () => {
  const b = new MemoryBlobBackend();
  await b.putBlob("k", "v", 3600);
  assert.equal(await b.getBlob("k", 0), null); // ttl 0 -> anything is already stale
  assert.equal(await b.getBlob("k", 60_000), "v");
});

test("getActiveBlobBackend defaults to null (built-in Redis) with no R2 env", () => {
  const saved = { ...process.env };
  delete process.env.R2_BUCKET; delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY; delete process.env.R2_ACCOUNT_ID; delete process.env.R2_ENDPOINT;
  delete process.env.TRAITFOLIO_BLOB_STORE;
  setBlobBackendForTests(undefined); // clear cache -> re-resolve from env
  assert.equal(getActiveBlobBackend(), null);
  process.env = saved;
  setBlobBackendForTests(undefined);
});

test("R2 backend auto-activates only when fully configured", () => {
  const saved = { ...process.env };
  process.env.R2_ACCOUNT_ID = "acct123";
  process.env.R2_BUCKET = "traitfolio";
  process.env.R2_ACCESS_KEY_ID = "AKID";
  process.env.R2_SECRET_ACCESS_KEY = "SECRET";
  delete process.env.R2_ENDPOINT;
  delete process.env.TRAITFOLIO_BLOB_STORE;
  setBlobBackendForTests(undefined);
  const backend = getActiveBlobBackend();
  assert.ok(backend, "expected R2 backend when fully configured");
  assert.equal(backend?.name, "r2");

  // Missing a secret -> safe fallback to Redis (null).
  delete process.env.R2_SECRET_ACCESS_KEY;
  setBlobBackendForTests(undefined);
  assert.equal(getActiveBlobBackend(), null);

  process.env = saved;
  setBlobBackendForTests(undefined);
});

test("TRAITFOLIO_BLOB_STORE=redis forces Redis even with R2 configured", () => {
  const saved = { ...process.env };
  process.env.R2_ACCOUNT_ID = "acct123";
  process.env.R2_BUCKET = "traitfolio";
  process.env.R2_ACCESS_KEY_ID = "AKID";
  process.env.R2_SECRET_ACCESS_KEY = "SECRET";
  process.env.TRAITFOLIO_BLOB_STORE = "redis";
  setBlobBackendForTests(undefined);
  assert.equal(getActiveBlobBackend(), null);
  process.env = saved;
  setBlobBackendForTests(undefined);
});

test("test override backend takes precedence", () => {
  const mem = new MemoryBlobBackend();
  setBlobBackendForTests(mem);
  assert.equal(getActiveBlobBackend(), mem);
  setBlobBackendForTests(undefined);
});
