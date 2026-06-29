import type { WalletVerifier } from "./types";
import { MockWalletVerifier } from "./verifiers/mock";
import { ChiaBlsWalletVerifier } from "./verifiers/chia-bls";

// Picks the active verifier from env, defaulting to mock (ARCHITECTURE.md §6/§7). Flipping the
// whole app to real verification is just WALLET_VERIFIER=chia-bls — no call sites change.
let cached: WalletVerifier | null = null;

export function getWalletVerifier(): WalletVerifier {
  if (cached) return cached;
  const key = process.env.WALLET_VERIFIER ?? "mock";
  cached = key === "chia-bls" ? new ChiaBlsWalletVerifier() : new MockWalletVerifier();
  return cached;
}

// Test seam — lets unit tests reset the cached singleton between env changes.
export function __resetWalletVerifier(): void {
  cached = null;
}
