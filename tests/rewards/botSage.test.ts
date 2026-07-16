// SageWallet WALLET-PIN guard: every path where the distribution wallet cannot be POSITIVELY confirmed must
// throw (fail-closed) — no pin configured, probe error, missing/empty fingerprint, mismatch — and sendCat must
// re-assert the pin before broadcasting anything. The Sage HTTP call is stubbed via global fetch; the exact
// RPC method name stays TODO-CONFIRM in botSage.ts, but a wrong method fails closed too (HTTP error -> throw).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SageWallet } from "../../src/lib/rewards/botSage";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Stub Sage: route each RPC method to a JSON body; records the methods called. */
function stubSage(routes: Record<string, unknown>): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    const method = String(url).split("/").pop() ?? "";
    calls.push(method);
    if (!(method in routes)) return { ok: false, status: 404, text: async () => "no such method" } as unknown as Response;
    return { ok: true, json: async () => routes[method] } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

const CFG = { rpcUrl: "http://localhost:9257", fingerprint: "2222222222" };

test("preflight: no fingerprint configured -> throws WITHOUT calling Sage (fail-closed)", async () => {
  const sage = stubSage({});
  await assert.rejects(new SageWallet({ rpcUrl: CFG.rpcUrl }).preflight(), /not configured/);
  assert.equal(sage.calls.length, 0);
});

test("preflight: probe errors (unknown method / Sage down) -> throws, never assumes", async () => {
  stubSage({}); // active-key method 404s
  await assert.rejects(new SageWallet(CFG).preflight(), /cannot confirm Sage's active wallet/);
});

test("preflight: Sage returns no/empty fingerprint -> throws", async () => {
  stubSage({ get_key: { key: { name: "x" } } });
  await assert.rejects(new SageWallet(CFG).preflight(), /cannot confirm/);
  stubSage({ get_key: { key: { fingerprint: "" } } });
  await assert.rejects(new SageWallet(CFG).preflight(), /cannot confirm/);
});

test("preflight: active fingerprint mismatch -> throws; match (number or string) -> ok", async () => {
  stubSage({ get_key: { key: { fingerprint: 1111111111 } } });
  await assert.rejects(new SageWallet(CFG).preflight(), /NOT the designated distribution wallet/);
  stubSage({ get_key: { key: { fingerprint: 2222222222 } } });
  await new SageWallet(CFG).preflight(); // JSON number vs config string must still match
  stubSage({ get_key: { key: { fingerprint: "2222222222" } } });
  await new SageWallet(CFG).preflight();
});

test("sendCat: re-asserts the pin FIRST — wrong active wallet means send_cat is never called", async () => {
  const sage = stubSage({ get_key: { key: { fingerprint: 1111111111 } }, send_cat: { transaction_id: "tx1" } });
  const w = new SageWallet(CFG);
  await assert.rejects(w.sendCat({ assetId: "a".repeat(64), toWallet: "xch1x", amountUnits: BigInt(1), dedupeTag: "k" }), /NOT the designated/);
  assert.ok(!sage.calls.includes("send_cat"), "send_cat must not be reached when the pin fails");
});

test("sendCat: pin passes -> send_cat proceeds and returns the tx id", async () => {
  stubSage({ get_key: { key: { fingerprint: 2222222222 } }, send_cat: { transaction_id: "tx-ok" } });
  const r = await new SageWallet(CFG).sendCat({ assetId: "a".repeat(64), toWallet: "xch1x", amountUnits: BigInt(1), dedupeTag: "k" });
  assert.equal(r.txId, "tx-ok");
});
