import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchOwnerListings } from "../../src/lib/data-sources/mintgarden/owner";
import { getMyHoldingsFast, binderGate, type MyHoldings } from "../../src/lib/portfolio/myHoldings";
import type { MgListItem, MgPage } from "../../src/lib/data-sources/mintgarden/types";

// A fresh xch1-shaped address per test so the local L1/checkpoint caches never collide between cases.
const ADDR = () => "xch1" + Math.random().toString(36).slice(2).padEnd(40, "q").slice(0, 40);

// Whale fixture: 10,000 items across 200 pages of 50.
const PAGES = 200;
function page(p: number, delayMs = 0): Promise<MgPage<MgListItem>> {
  const items = Array.from({ length: 50 }, (_, i) => ({
    encoded_id: `nft1p${p}i${i}`,
    collection_id: "col1whale",
    name: `Whale #${p * 50 + i + 1}`,
  })) as unknown as MgListItem[];
  const res: MgPage<MgListItem> = { items, next: p < PAGES - 1 ? String(p + 1) : null, previous: null };
  return new Promise((r) => setTimeout(() => r(res), delayMs));
}
// Signature matches listAddressNfts (address, cursor, size, type, throwOnError, background, includeMetadata).
type ListFn = typeof import("../../src/lib/data-sources/mintgarden/client").listAddressNfts;

test("whale wallet: budget-exhausted first pass returns PROGRESS + warming:true, never zero-and-done", async () => {
  const listFn = ((_a: string, cur?: string | null) => page(cur ? Number(cur) : 0, 15)) as unknown as ListFn;
  const r = await fetchOwnerListings(ADDR(), { budgetMs: 400, listFn });
  assert.equal(r.warming, true);           // more pages remain -> poll resumes
  assert.ok(r.items.length > 0);           // and we DID make progress (not a vacuous warming)
  assert.ok(r.items.length < 10_000);
});

test("first /profile page times out WITH metadata: retries drop metadata and the scan still advances", async () => {
  const listFn = ((_a: string, cur?: string | null, _s?: number, _t?: string, _th?: boolean, _bg?: boolean, withMeta?: boolean) => {
    if (withMeta) return Promise.reject(new Error("timed out after 15000ms"));
    return page(cur ? Number(cur) : 0);
  }) as unknown as ListFn;
  const r = await fetchOwnerListings(ADDR(), { budgetMs: 20_000, listFn });
  assert.ok(r.items.length >= 50, "metadata-free fallback must land page 1");
  assert.equal(r.items.length === 0 && !r.warming, false, "never zero-and-done");
});

test("first page fails ALL retries: empty but warming:true (resume next poll), never complete-empty", async () => {
  const listFn = (() => Promise.reject(new Error("HTTP 429"))) as unknown as ListFn;
  const r = await fetchOwnerListings(ADDR(), { budgetMs: 2_000, listFn });
  assert.deepEqual([r.items.length, r.warming], [0, true]);
});

test("upstream degrades to 200-empty for a big DID: confirm-empty probe keeps it warming", async () => {
  // metadata page returns empty; the metadata-free confirm probe returns items -> not a completed empty wallet.
  const listFn = ((_a: string, cur?: string | null, _s?: number, _t?: string, _th?: boolean, _bg?: boolean, withMeta?: boolean) =>
    withMeta ? Promise.resolve({ items: [], next: null, previous: null } as MgPage<MgListItem>) : page(0)) as unknown as ListFn;
  const r = await fetchOwnerListings(ADDR(), { budgetMs: 5_000, listFn });
  assert.equal(r.warming, true, "unconfirmed empty must not read as a completed empty wallet");
});

test("genuinely empty wallet still completes (No NFTs found stays correct)", async () => {
  const listFn = (() => Promise.resolve({ items: [], next: null, previous: null } as MgPage<MgListItem>)) as unknown as ListFn;
  const r = await fetchOwnerListings(ADDR(), { budgetMs: 5_000, listFn });
  assert.deepEqual([r.items.length, r.warming], [0, false]);
});

test("getMyHoldingsFast: an owner read that pages partially surfaces warming, and the gate renders the binder", async () => {
  const listFn = ((_a: string, cur?: string | null) => page(cur ? Number(cur) : 0, 15)) as unknown as ListFn;
  const h = await getMyHoldingsFast([ADDR()], { budgetMs: 300, listFn });
  assert.equal(h.warming, true, "unfinished scan must render as warming, never a completed empty");
  const gate = binderGate(1, h);
  assert.equal(gate.noResults, false, '"No NFTs found" must not fire while an address may still hold NFTs');
  assert.ok(gate.showBinder, "binder renders so the /api/holdings poll can finish the roster");
});

test("binderGate: zero + confirmed-complete is the ONLY empty state", () => {
  const base: MyHoldings = { nfts: [], totalEstimateXch: 0, totalEstimateUsd: 0, xchUsdRate: 15, collections: [], addresses: ["x"], truncated: false, warming: false, demo: false };
  assert.equal(binderGate(1, { ...base, warming: true }).noResults, false);
  assert.equal(binderGate(1, { ...base, warming: false }).noResults, true);
  assert.equal(binderGate(0, null).noResults, false);
});
