import { createHash } from "node:crypto";
import type { SignedProof, VerificationResult, WalletVerifier } from "../types";

// Deterministic stand-in so the full challenge-response flow + UI work end-to-end with no wallet
// or BLS dependency (ARCHITECTURE.md "mock before live"). It mirrors the real verifier's contract:
//   - the pubkey must bind to the address (mock analogue of puzzle-hash reconstruction)
//   - the signature must match mockSignature(address, message, pubkey)
// The real ChiaBlsWalletVerifier swaps in the crypto; nothing else in the app changes.

// Pure helper the dev "simulate signature" path uses to fabricate an acceptable proof.
export function mockSignature(address: string, message: string, pubkey: string): string {
  return createHash("sha256").update(`${pubkey}|${address}|${message}`).digest("hex");
}

// Stub pubkey a simulated wallet returns for an address (stands in for the real G1 key).
export function mockPubkey(address: string): string {
  return createHash("sha256").update(`pubkey|${address}`).digest("hex").slice(0, 96);
}

export class MockWalletVerifier implements WalletVerifier {
  readonly id = "mock";

  async verify(proof: SignedProof): Promise<VerificationResult> {
    const { address, message, pubkey, signature } = proof;
    if (!address || !message || !pubkey || !signature) {
      return { ok: false, reason: "malformed", detail: "missing field" };
    }
    if (pubkey !== mockPubkey(address)) {
      return { ok: false, reason: "address_mismatch" };
    }
    if (signature !== mockSignature(address, message, pubkey)) {
      return { ok: false, reason: "bad_signature" };
    }
    return { ok: true };
  }
}
