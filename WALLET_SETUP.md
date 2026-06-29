# Wallet Connect & Verification Setup

This guide turns on real wallet linking. It has **two independent halves**:

1. **Sage connect (client):** lets a user connect Sage via WalletConnect and sign the challenge.
2. **Real verification (server):** independently checks that signature is valid. **Security-critical.**

The app ships safe by default: `WALLET_VERIFIER=mock`, no WalletConnect project id. In that state
the profile offers manual linking + a dev "simulate signature" button, and nothing real is trusted.

> **Important:** these are the only parts of the platform that touch cryptography and a user's
> wallet. Do **not** enable real verification in production without a developer implementing it and
> a security review. Getting it wrong doesn't risk anyone's funds (we never request transaction
> signing), but a flawed verifier could let someone falsely claim an address they don't own.

---

## Part 1 — Sage connect (client)

**A. Get a WalletConnect project id (free)**
1. Go to https://dashboard.reown.com (formerly WalletConnect Cloud).
2. Create a project → copy the Project ID.

**B. Set env vars** (in `.env`):
```
NEXT_PUBLIC_WC_PROJECT_ID="your-project-id"
NEXT_PUBLIC_WC_CHAIN="chia:mainnet"   # or chia:testnet
```

**C. Install the WalletConnect client:**
```
npm install @walletconnect/sign-client
```

That's it — the "Connect Sage Wallet" button on the profile activates automatically (the connector
in `src/lib/wallet/connect/sage.ts` loads the SDK at runtime). The connect flow shows a pairing URI
the user pastes into **Sage → Settings → WalletConnect**, then Sage prompts them to sign.

The connector is **not** security-critical: whatever proof it produces is checked server-side, so a
bug there can only cause a verification to fail, never a false pass.

---

## Part 2 — Real signature verification (server) — security-critical

Until this is done, keep `WALLET_VERIFIER=mock`. Real Sage signatures will be **rejected** by the
mock verifier — that's expected.

**A. Install the Chia SDK:**
```
npm install chia-wallet-sdk
```
(`chia-wallet-sdk` is the canonical, maintained library from the Sage author — Node bindings.)

**B. Implement `ChiaBlsWalletVerifier.verify`** in `src/lib/wallet/verifiers/chia-bls.ts`. The
header in that file documents the exact algorithm. Two checks, **both required**:

1. **Signature** — verify the BLS12-381 signature (AugScheme) over the CHIP-0002 digest
   `sha256tree( ("Chia Signed Message", proof.message) )` under `proof.pubkey`.
2. **Address binding** — derive the standard puzzle hash from `proof.pubkey`
   (synthetic key → `p2_delegated_puzzle_or_hidden_puzzle` → tree hash → bech32m) and require it to
   equal `proof.address`. This is what stops a valid signature from an *unrelated* key.

Reference shape (confirm exact method names against the installed `chia-wallet-sdk` types):
```ts
// PSEUDOCODE — verify against the SDK's actual API + add tests before trusting.
import { PublicKey, Signature /* , address/puzzle helpers */ } from "chia-wallet-sdk";

async verify(proof) {
  // 1. signature over CHIP-0002 digest
  const digest = chip0002Digest(proof.message);            // sha256tree(("Chia Signed Message", msg))
  const pk  = PublicKey.fromHex(proof.pubkey);
  const sig = Signature.fromHex(proof.signature);
  if (!verifyAug(pk, digest, sig)) return { ok: false, reason: "bad_signature" };

  // 2. pubkey must reconstruct to the claimed address
  const expected = addressFromPublicKey(pk, "xch");        // synthetic -> p2 puzzle hash -> bech32m
  if (expected !== proof.address) return { ok: false, reason: "address_mismatch" };

  return { ok: true };
}
```

**C. Test before enabling:**
- Connect a real Sage wallet on **testnet** (`NEXT_PUBLIC_WC_CHAIN=chia:testnet`).
- Add unit tests with a captured real `{ address, message, pubkey, signature }` from a test wallet:
  a tampered message must fail, a signature from a different address must fail (`address_mismatch`).
- Only then set `WALLET_VERIFIER=chia-bls`.

**D. Security review.** Have a developer familiar with Chia/BLS review this file before production.

---

## Why Goby isn't here yet

Chia Network issued a security notice flagging the community Goby extension in relation to the
"Raccoon Stealer v2" malware (which targets browser-extension wallets). Until that's clearly
resolved we don't steer users to connect Goby. The connector layer (`getWalletConnector`) is built
so a vetted wallet can be added later without touching the verification or UI code.
