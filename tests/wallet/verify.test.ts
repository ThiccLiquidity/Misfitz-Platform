import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHALLENGE_TTL_MS,
  buildChallengeMessage,
  generateNonce,
  isExpired,
  isValidChiaAddress,
} from "../../src/lib/wallet/message";
import { MockWalletVerifier, mockPubkey, mockSignature } from "../../src/lib/wallet/verifiers/mock";
import { ChiaBlsWalletVerifier } from "../../src/lib/wallet/verifiers/chia-bls";
import { getWalletVerifier, __resetWalletVerifier } from "../../src/lib/wallet/registry";
import type { SignedProof } from "../../src/lib/wallet/types";

const ADDRESS = "xch1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpz";

function liveChallenge() {
  const nonce = generateNonce();
  const message = buildChallengeMessage({ address: ADDRESS, nonce, issuedAt: new Date() });
  return { nonce, message };
}

function validProof(message: string, address = ADDRESS): SignedProof {
  const pubkey = mockPubkey(address);
  return { address, message, pubkey, signature: mockSignature(address, message, pubkey) };
}

test("nonce is unique and 64 hex chars", () => {
  const a = generateNonce();
  const b = generateNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("challenge message embeds address + nonce and disclaims transactions", () => {
  const { nonce, message } = liveChallenge();
  assert.ok(message.includes(ADDRESS));
  assert.ok(message.includes(nonce));
  assert.match(message, /not a transaction/i);
});

test("isExpired respects the TTL window", () => {
  const now = new Date();
  const future = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const past = new Date(now.getTime() - 1);
  assert.equal(isExpired(future, now), false);
  assert.equal(isExpired(past, now), true);
});

test("isValidChiaAddress accepts xch1 + rejects junk", () => {
  assert.equal(isValidChiaAddress(ADDRESS), true);
  assert.equal(isValidChiaAddress("txch1abcdefghijklmnopqrstuvwxyz0234567890qq"), false); // wrong prefix
  assert.equal(isValidChiaAddress("xch1short"), false);
  assert.equal(isValidChiaAddress("0xdeadbeef"), false);
  assert.equal(isValidChiaAddress(42), false);
});

test("MockWalletVerifier accepts a correctly simulated proof", async () => {
  const { message } = liveChallenge();
  const result = await new MockWalletVerifier().verify(validProof(message));
  assert.deepEqual(result, { ok: true });
});

test("MockWalletVerifier rejects a tampered message (replay/forge attempt)", async () => {
  const { message } = liveChallenge();
  const proof = validProof(message);
  const tampered = { ...proof, message: message + "X" };
  const result = await new MockWalletVerifier().verify(tampered);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "bad_signature");
});

test("MockWalletVerifier rejects a pubkey that does not bind to the address", async () => {
  const { message } = liveChallenge();
  const proof = { ...validProof(message), pubkey: mockPubkey("xch1someoneelseaddressaaaaaaaaaaaaaaaaaaaaaa") };
  const result = await new MockWalletVerifier().verify(proof);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "address_mismatch");
});

test("MockWalletVerifier rejects missing fields as malformed", async () => {
  const result = await new MockWalletVerifier().verify({ address: "", message: "", pubkey: "", signature: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "malformed");
});

test("registry defaults to the mock verifier", () => {
  __resetWalletVerifier();
  delete process.env.WALLET_VERIFIER;
  assert.equal(getWalletVerifier().id, "mock");
});

test("registry selects chia-bls when configured", () => {
  __resetWalletVerifier();
  process.env.WALLET_VERIFIER = "chia-bls";
  assert.equal(getWalletVerifier().id, "chia-bls");
  __resetWalletVerifier();
  delete process.env.WALLET_VERIFIER;
});

test("ChiaBlsWalletVerifier is still a stub (throws), but rejects unsupported modes first", async () => {
  const v = new ChiaBlsWalletVerifier();
  const bad = await v.verify({ address: ADDRESS, message: "m", pubkey: "p", signature: "s", signingMode: "nope" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "unsupported_mode");
  await assert.rejects(() => v.verify({ address: ADDRESS, message: "m", pubkey: "p", signature: "s" }));
});
