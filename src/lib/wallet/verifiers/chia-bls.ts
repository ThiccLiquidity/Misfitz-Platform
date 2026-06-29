import {
  CHIP0002_P2_DELEGATED,
  type SignedProof,
  type VerificationResult,
  type WalletVerifier,
} from "../types";

// Real server-side ownership verification — the drop-in that replaces MockWalletVerifier once
// Misfitz is live (ARCHITECTURE.md §6). Two independent checks, BOTH required:
//
//   1. SIGNATURE — verify the BLS12-381 signature over the CHIP-0002 digest:
//        digest = sha256tree( ("Chia Signed Message", proof.message) )
//      under proof.pubkey, AUG scheme (signing mode CHIP0002_P2_DELEGATED).
//
//   2. ADDRESS BINDING — prove proof.pubkey actually owns proof.address. An address is a puzzle
//      hash, NOT a public key, so step 1 alone is insufficient:
//        synthetic_pk = calculate_synthetic_public_key(proof.pubkey, DEFAULT_HIDDEN_PUZZLE_HASH)
//        puzzle       = p2_delegated_puzzle_or_hidden_puzzle(synthetic_pk)
//        puzzle_hash  = sha256tree(puzzle)
//        expected     = bech32m_encode("xch", puzzle_hash)
//      then require expected === proof.address.
//
// Implementation will use the Chia wallet-sdk WASM bindings (no native build step). Isolated to
// this one module so swapping mock -> real is a one-line change in registry.ts.
export class ChiaBlsWalletVerifier implements WalletVerifier {
  readonly id = "chia-bls";

  async verify(proof: SignedProof): Promise<VerificationResult> {
    if (proof.signingMode && proof.signingMode !== CHIP0002_P2_DELEGATED) {
      return { ok: false, reason: "unsupported_mode", detail: proof.signingMode };
    }
    throw new Error(
      "ChiaBlsWalletVerifier is not implemented yet. Keep WALLET_VERIFIER=mock until Misfitz is " +
        "live and the Chia wallet-sdk BLS verification is wired in (see this file's header).",
    );
  }
}
