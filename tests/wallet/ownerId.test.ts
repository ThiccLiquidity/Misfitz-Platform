import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidChiaOwnerId, parseOwnerIds } from "../../src/lib/wallet/ownerId";

const ADDR = "xch1zkc096dg5ee5j8gl3gxl7acxpk42zdyar2lra8r034m35c0yy8fqlhsyxh";

test("isValidChiaOwnerId accepts a real xch1 address, rejects junk", () => {
  assert.equal(isValidChiaOwnerId(ADDR), true);
  assert.equal(isValidChiaOwnerId(ADDR.toUpperCase()), true); // lowercased internally
  assert.equal(isValidChiaOwnerId("not-an-address"), false);
  assert.equal(isValidChiaOwnerId(""), false);
  assert.equal(isValidChiaOwnerId(123 as unknown), false);
});

test("parseOwnerIds extracts valid ids, dedups, drops junk, preserves order", () => {
  assert.deepEqual(parseOwnerIds(`${ADDR}, junk ${ADDR} nope`), [ADDR]);
  assert.deepEqual(parseOwnerIds("garbage only"), []);
});
