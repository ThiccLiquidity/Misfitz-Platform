// The wallet-verification seam. Mirrors the DataSource pattern (ARCHITECTURE.md §7): one
// interface, swappable implementations chosen by env in registry.ts. Mock today, real Chia BLS
// later — the /api/wallet/verify route never changes.

// CHIP-0002 signing mode for proving ownership of an *address* (the P2 delegated puzzle key).
// Reported by Chia wallets via chia_signMessageByAddress.
// https://docs.chia.net/walletconnect-commands
export const CHIP0002_P2_DELEGATED =
  "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG:CHIP-0002_P2_DELEGATED_PUZZLE";

// What a wallet hands back after signing, plus the address and exact message signed.
// Connection-agnostic: Sage (WalletConnect) and Goby (injected provider) both produce this shape,
// so the server-side verifier doesn't care which wallet was used.
export interface SignedProof {
  address: string; // xch1... bech32m address being claimed
  message: string; // exact human-readable string that was signed
  pubkey: string; // hex G1 public key returned by the wallet
  signature: string; // hex BLS12-381 G2 signature
  signingMode?: string; // CHIP-0002 signing mode reported by the wallet
}

export type VerificationFailureReason =
  | "bad_signature" // signature does not verify under pubkey for this message
  | "address_mismatch" // pubkey does not reconstruct to the claimed address
  | "unsupported_mode" // signing mode is not an accepted ownership-proof mode
  | "malformed"; // inputs not parseable (bad hex, wrong lengths, missing fields)

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: VerificationFailureReason; detail?: string };

// Implemented by MockWalletVerifier (now) and ChiaBlsWalletVerifier (later).
export interface WalletVerifier {
  readonly id: string; // "mock" | "chia-bls"
  verify(proof: SignedProof): Promise<VerificationResult>;
}
