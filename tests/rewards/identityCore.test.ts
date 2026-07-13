import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptOut, identityOrOptOut } from "../../src/lib/rewards/identityCore";

test("parseOptOut: splits on commas/whitespace, lowercases, drops blanks", () => {
  const s = parseOptOut(" xch1ABC, did:chia:XYZ\n  xch1def ");
  assert.equal(s.has("xch1abc"), true);
  assert.equal(s.has("did:chia:xyz"), true);
  assert.equal(s.has("xch1def"), true);
  assert.equal(s.size, 3);
  assert.equal(parseOptOut(undefined).size, 0);
  assert.equal(parseOptOut("").size, 0);
});

test("identityOrOptOut: resolves name+avatar, empties collapse to null", () => {
  const none = new Set<string>();
  assert.deepEqual(identityOrOptOut("xch1a", "Alice", "https://assets.mainnet.mintgarden.io/a.webp", none), { name: "Alice", avatarUrl: "https://assets.mainnet.mintgarden.io/a.webp" });
  assert.deepEqual(identityOrOptOut("xch1a", "  ", "", none), { name: null, avatarUrl: null });
  assert.deepEqual(identityOrOptOut("xch1a", null, null, none), { name: null, avatarUrl: null });
});

test("identityOrOptOut: an opted-out wallet is blanked even if it has a profile (case-insensitive)", () => {
  const optOut = parseOptOut("xch1secret");
  assert.deepEqual(identityOrOptOut("XCH1SECRET", "Whale", "https://assets.mainnet.mintgarden.io/w.webp", optOut), { name: null, avatarUrl: null });
  // a different wallet is unaffected
  assert.deepEqual(identityOrOptOut("xch1other", "Pub", null, optOut), { name: "Pub", avatarUrl: null });
});

import { sanitizeName, sanitizeAvatar } from "../../src/lib/rewards/identityCore";

test("sanitizeAvatar: only https MintGarden CDN URLs pass; everything else -> null", () => {
  assert.equal(sanitizeAvatar("https://assets.mainnet.mintgarden.io/profiles/abc.webp"), "https://assets.mainnet.mintgarden.io/profiles/abc.webp");
  assert.equal(sanitizeAvatar("http://assets.mainnet.mintgarden.io/x.webp"), null); // not https
  assert.equal(sanitizeAvatar("https://evil.example.com/x.webp"), null);            // wrong host
  assert.equal(sanitizeAvatar("https://mintgarden.io.evil.com/x.webp"), null);      // suffix spoof
  assert.equal(sanitizeAvatar("javascript:alert(1)"), null);
  assert.equal(sanitizeAvatar("not a url"), null);
  assert.equal(sanitizeAvatar(null), null);
});

test("sanitizeName: strips control/bidi chars, collapses whitespace, caps length", () => {
  assert.equal(sanitizeName("  Alice  "), "Alice");
  const bidi = "A" + String.fromCharCode(0x202e) + "l" + String.fromCharCode(0x200b) + "ice";
  assert.equal(sanitizeName(bidi), "Alice"); // bidi override + zero-width removed
  assert.equal(sanitizeName(" "), null);      // pure whitespace -> null
  const long = "x".repeat(80);
  assert.equal(sanitizeName(long)!.length, 40);
});
