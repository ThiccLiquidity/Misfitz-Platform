import { test } from "node:test";
import assert from "node:assert/strict";
import { runBotPayout } from "../../src/lib/rewards/bot";
import { buildRewardManifest, signManifest, CHIA_ASSET_ID, type PayoutManifest } from "../../src/lib/rewards/manifest";
import { computeEpoch, distributeChia } from "../../src/lib/rewards/engine";
import { settleUnattributed } from "../../src/lib/rewards/settle";
import { toSale, type RawSale } from "../../src/lib/rewards/detect";
import type { BotDeps, LedgerStore, WalletRpc } from "../../src/lib/rewards/botDeps";
import { paymentKey, manifestSentinelKey } from "../../src/lib/rewards/manifestGuard";

const A = (c: string) => "xch1" + c.repeat(58);
const verifySig = (h: string, sig: string) => sig === "sig:" + h;
const OPTS = { allowedAssets: [CHIA_ASSET_ID], fundingCapUnits: BigInt(1_000_000) };

function manifest(provenance: "shadow" | "chain-verified" = "chain-verified", sign = true): PayoutManifest {
  const epoch = computeEpoch([toSale({ offerId: "s1", nftId: "n1", priceXch: 100, soldAt: 1, buyer: A("a"), seller: A("b") } as RawSale, null)], [], 0, 10);
  const s = settleUnattributed(epoch);
  const chia = distributeChia(s.payable, s.verifiedRewardPotMojos, BigInt(1_000_000));
  const m = buildRewardManifest("2026-06", s.payable, chia, 1, s.routedToBurnMojos, CHIA_ASSET_ID, provenance, "col1");
  return sign ? signManifest(m, (h) => "sig:" + h) : m;
}

function store(seedLedger: [string, string][] = [], seedIntended: [string, string][] = []) {
  const led = new Map<string, string>(seedLedger);
  const intended = new Map<string, string>(seedIntended);
  const impl: LedgerStore = {
    load: async () => new Map(led),
    markIntended: async (k, a) => { intended.set(k, a); },
    markDone: async (k, a, _tx) => { led.set(k, a); intended.delete(k); },
    intended: async () => [...intended.entries()].map(([key, amountUnits]) => ({ key, amountUnits })),
  };
  return { impl, led, intended };
}
function wallet(o: { fail?: boolean; noConfirm?: boolean; lookupTx?: (t: string) => Promise<string | null> } = {}) {
  const sends: string[] = [];
  const impl: WalletRpc = {
    sendCat: async (p) => { if (o.fail) throw new Error("boom"); sends.push(p.toWallet); return { txId: "tx-" + p.toWallet.slice(-4) }; },
    waitConfirmed: async () => !o.noConfirm,
    lookupTx: o.lookupTx,
  };
  return { impl, sends };
}
const deps = (s: LedgerStore, w: WalletRpc, confirm = true): BotDeps => ({ store: s, wallet: w, verifySig, gate: { confirm: async () => confirm } });

test("happy path: signed + chain-verified reward manifest -> all sent, ledger recorded", async () => {
  const m = manifest();
  const st = store(); const w = wallet();
  const r = await runBotPayout(m, deps(st.impl, w.impl), OPTS);
  assert.equal(r.status, "completed", r.haltReason);
  assert.equal(r.sent.length, m.recipients.length);
  assert.equal(st.led.size, m.recipients.length + 1); // recipients + the epoch sentinel
});

test("halts: missing signature, and a non-chain-verified reward manifest", async () => {
  const unsigned = await runBotPayout(manifest("chain-verified", false), deps(store().impl, wallet().impl), OPTS);
  assert.equal(unsigned.status, "halted");
  const shadow = await runBotPayout(manifest("shadow", true), deps(store().impl, wallet().impl), OPTS);
  assert.equal(shadow.status, "halted");
  assert.match(shadow.haltReason ?? "", /chain-verified/);
});

test("operator declines -> aborted, nothing sent", async () => {
  const w = wallet();
  const r = await runBotPayout(manifest(), deps(store().impl, w.impl, false), OPTS);
  assert.equal(r.status, "aborted");
  assert.equal(w.sends.length, 0);
});

test("send failure mid-run -> halt; the ledger/sent state is preserved (no double-pay on rerun)", async () => {
  const r = await runBotPayout(manifest(), deps(store().impl, wallet({ fail: true }).impl), OPTS);
  assert.equal(r.status, "halted");
  assert.equal(r.sent.length, 0);
});

test("already-paid recipients are skipped (idempotent rerun)", async () => {
  const m = manifest();
  const seed = m.recipients.map((rr) => [paymentKey(m, rr), rr.amountUnits] as [string, string]);
  const w = wallet();
  const r = await runBotPayout(m, deps(store(seed).impl, w.impl), OPTS);
  assert.equal(r.status, "completed");
  assert.equal(r.skippedAlreadyPaid, m.recipients.length);
  assert.equal(w.sends.length, 0);
});

test("crash recovery: an unresolved intended halts; a resolvable one is marked done", async () => {
  const m = manifest();
  const key0 = paymentKey(m, m.recipients[0]);
  // unresolved (no lookupTx) -> halt
  const halted = await runBotPayout(m, deps(store([], [[key0, m.recipients[0].amountUnits]]).impl, wallet().impl), OPTS);
  assert.equal(halted.status, "halted");
  assert.match(halted.haltReason ?? "", /unresolved intended/);
  // resolvable via lookupTx -> proceeds to completion
  const w = wallet({ lookupTx: async () => "tx-recovered" });
  const ok = await runBotPayout(m, deps(store([], [[key0, m.recipients[0].amountUnits]]).impl, w.impl), OPTS);
  assert.equal(ok.status, "completed", ok.haltReason);
});

test("send that never confirms -> halt (funds not marked done)", async () => {
  const r = await runBotPayout(manifest(), deps(store().impl, wallet({ noConfirm: true }).impl), OPTS);
  assert.equal(r.status, "halted");
  assert.match(r.haltReason ?? "", /not confirmed/);
});

test("no signature verifier configured -> halt before anything (F1)", async () => {
  const d = deps(store().impl, wallet().impl);
  const r = await runBotPayout(manifest(), { ...d, verifySig: undefined as unknown as typeof d.verifySig }, OPTS);
  assert.equal(r.status, "halted");
  assert.match(r.haltReason ?? "", /signature verifier/);
});

// ---- Wallet pin (preflight): the bot must only ever spend from the DESIGNATED distribution wallet.

test("wallet pin: preflight throws (wrong/unknown fingerprint) -> halt, nothing sent", async () => {
  const w = wallet();
  w.impl.preflight = async () => { throw new Error("Sage's active wallet fingerprint 111 is NOT the designated distribution wallet 222"); };
  const r = await runBotPayout(manifest(), deps(store().impl, w.impl), OPTS);
  assert.equal(r.status, "halted");
  assert.match(r.haltReason ?? "", /preflight failed/);
  assert.match(r.haltReason ?? "", /NOT the designated distribution wallet/);
  assert.equal(w.sends.length, 0);
});

test("wallet pin: requireWalletPreflight refuses a wallet impl WITHOUT the guard (fail-closed)", async () => {
  const w = wallet(); // no preflight()
  const r = await runBotPayout(manifest(), deps(store().impl, w.impl), { ...OPTS, requireWalletPreflight: true });
  assert.equal(r.status, "halted");
  assert.match(r.haltReason ?? "", /no preflight/);
  assert.equal(w.sends.length, 0);
});

test("wallet pin: a passing preflight runs exactly once (pre-loop) and sends proceed", async () => {
  const m = manifest();
  const w = wallet();
  let probes = 0;
  w.impl.preflight = async () => { probes++; };
  const r = await runBotPayout(m, deps(store().impl, w.impl), { ...OPTS, requireWalletPreflight: true });
  assert.equal(r.status, "completed", r.haltReason);
  assert.equal(probes, 1);
  assert.equal(w.sends.length, m.recipients.length);
});

// ---- Epoch sentinel: a one-time payout epoch can only ever be sent from ONE manifest.

test("epoch sentinel: a DIFFERENT manifest for an already-started epoch halts (no over-emit on re-cut)", async () => {
  const m = manifest();
  const st = store([[manifestSentinelKey(m), "0000000000different0000000000"]]); // epoch started with another manifest
  const w = wallet();
  const r = await runBotPayout(m, deps(st.impl, w.impl), OPTS);
  assert.equal(r.status, "halted");
  assert.match(r.haltReason ?? "", /already started with a different manifest/);
  assert.equal(w.sends.length, 0);
});

test("epoch sentinel: the SAME manifest resumes cleanly (hash matches) and pays the rest", async () => {
  const m = manifest();
  const st = store([[manifestSentinelKey(m), m.hash]]); // epoch already pinned to THIS manifest
  const w = wallet();
  const r = await runBotPayout(m, deps(st.impl, w.impl), OPTS);
  assert.equal(r.status, "completed", r.haltReason);
  assert.equal(w.sends.length, m.recipients.length);
});

test("epoch sentinel: a first run writes the sentinel = manifest hash", async () => {
  const m = manifest();
  const st = store();
  await runBotPayout(m, deps(st.impl, wallet().impl), OPTS);
  assert.equal(st.led.get(manifestSentinelKey(m)), m.hash);
});
