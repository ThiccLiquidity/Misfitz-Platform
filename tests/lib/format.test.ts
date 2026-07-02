import { test } from "node:test";
import assert from "node:assert/strict";
import { formatXch, formatUsd, truncateAddress, formatXchShort, formatUsdShort } from "../../src/lib/format";

test("formatXch / formatUsd use fixed 2 decimals", () => {
  assert.equal(formatXch(1.5), "1.50 XCH");
  assert.equal(formatUsd(1.5), "$1.50");
});

test("truncateAddress keeps short strings, elides long ones", () => {
  assert.equal(truncateAddress("short"), "short");
  const a = "xch1zkc096dg5ee5j8gl3gxl7acxpk42zdyar2lra8r034m35c0yy8fqlhsyxh";
  const t = truncateAddress(a);
  assert.ok(t.includes("…") && t.length < a.length);
});

test("compact short formatting for big headline numbers", () => {
  assert.equal(formatXchShort(4900), "4.9K XCH");
  assert.equal(formatUsdShort(1_200_000), "$1.2M");
  assert.equal(formatXchShort(5), "5.00 XCH");
});
