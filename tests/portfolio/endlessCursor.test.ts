import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchOwnerListings } from "../../src/lib/data-sources/mintgarden/owner";
import type { MgListItem, MgPage } from "../../src/lib/data-sources/mintgarden/types";

type ListFn = typeof import("../../src/lib/data-sources/mintgarden/client").listAddressNfts;
const ADDR = () => "xch1" + Math.random().toString(36).slice(2).padEnd(40, "q").slice(0, 40);

const mk = (p: number, n: number): MgListItem[] =>
  Array.from({ length: n }, (_, i) => ({ encoded_id: `nft1p${p}i${i}`, collection_id: "col1endless", name: `#${p * 100 + i + 1}` })) as unknown as MgListItem[];

// MEASURED PRODUCTION BEHAVIOUR of MintGarden's /address pager, on a real 544-NFT wallet:
//   page 1-5 -> 100 items    page 6 -> 44 items    pages 7..40 -> ZERO items, `next` STILL set
// The cursor never goes null. The pager's only exit was `while (cursor && ...)`, so past the real end it
// span on empty pages until the time budget expired — which meant `complete` was false on EVERY pass, the
// roster was NEVER persisted, and every binder load re-paged the whole wallet from zero while the render
// died against the function cap. Not slowness: no terminating condition.
test("endless cursor: an empty page ends the scan and the wallet COMPLETES", async () => {
  let pagesServed = 0;
  const listFn = ((_a: string, cur?: string | null) => {
    const p = cur ? Number(cur) : 0;
    pagesServed += 1;
    const items = p < 5 ? mk(p, 100) : p === 5 ? mk(p, 44) : [];
    return Promise.resolve({ items, next: String(p + 1), previous: null } as MgPage<MgListItem>); // next NEVER null
  }) as unknown as ListFn;

  const r = await fetchOwnerListings(ADDR(), { budgetMs: 20_000, listFn });
  assert.equal(r.items.length, 544, "every real item must still be collected");
  assert.equal(r.warming, false, "the scan MUST complete — otherwise the roster is never persisted");
  assert.ok(pagesServed <= 8, `must stop at the first empty page, served ${pagesServed}`);
});

test("looping cursor: repeated pages of duplicates also end the scan", async () => {
  // The other shape of a non-terminating pager: it keeps returning items, but no NEW ids.
  let pagesServed = 0;
  const listFn = ((_a: string, cur?: string | null) => {
    const p = cur ? Number(cur) : 0;
    pagesServed += 1;
    return Promise.resolve({ items: mk(Math.min(p, 1), 100), next: String(p + 1), previous: null } as MgPage<MgListItem>);
  }) as unknown as ListFn;

  const r = await fetchOwnerListings(ADDR(), { budgetMs: 20_000, listFn });
  assert.equal(r.warming, false, "a looping cursor must not warm forever");
  assert.equal(r.items.length, 200, "the two distinct pages are kept");
  assert.ok(pagesServed <= 6, `must bail once pages stop adding new ids, served ${pagesServed}`);
});

test("a normal terminating cursor is unaffected", async () => {
  const listFn = ((_a: string, cur?: string | null) => {
    const p = cur ? Number(cur) : 0;
    return Promise.resolve({ items: mk(p, 100), next: p < 2 ? String(p + 1) : null, previous: null } as MgPage<MgListItem>);
  }) as unknown as ListFn;
  const r = await fetchOwnerListings(ADDR(), { budgetMs: 20_000, listFn });
  assert.equal(r.items.length, 300);
  assert.equal(r.warming, false);
});

test("a genuinely mid-scan budget stop still returns warming (resume, don't fake completion)", async () => {
  const listFn = ((_a: string, cur?: string | null) => {
    const p = cur ? Number(cur) : 0;
    return new Promise<MgPage<MgListItem>>((res) =>
      setTimeout(() => res({ items: mk(p, 100), next: String(p + 1), previous: null }), 40));
  }) as unknown as ListFn;
  const r = await fetchOwnerListings(ADDR(), { budgetMs: 250, listFn });
  assert.equal(r.warming, true, "a real budget stop must still resume via the checkpoint");
  assert.ok(r.items.length > 0, "and must not be a vacuous warming");
});
