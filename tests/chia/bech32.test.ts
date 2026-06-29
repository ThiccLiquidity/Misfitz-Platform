import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeChiaAddress, addressToPuzzleHashHex } from "../../src/lib/chia/bech32";

test("decodes a real Chia address to its puzzle-hash hex", () => {
  const addr = "xch1zkc096dg5ee5j8gl3gxl7acxpk42zdyar2lra8r034m35c0yy8fqlhsyxh";
  const d = decodeChiaAddress(addr);
  assert.equal(d?.hrp, "xch");
  assert.equal(d?.hex, "15b0f2e9a8a673491d1f8a0dff77060daaa1349d1abe3e9c6f8d771a61e421d2");
  assert.equal(d?.hex.length, 64); // 32 bytes
});

test("rejects malformed / wrong-checksum input", () => {
  assert.equal(decodeChiaAddress("xch1zzzzz"), null);
  assert.equal(decodeChiaAddress("not-an-address"), null);
  assert.equal(addressToPuzzleHashHex("xch1zkc096dg5ee5j8gl3gxl7acxpk42zdyar2lra8r034m35c0yy8fqlhsyxX"), null);
});
