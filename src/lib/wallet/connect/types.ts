// Client-side wallet connection seam. Mirrors the server WalletVerifier pattern: one interface,
// per-wallet implementations. A connector's only job is to produce a signed proof; whether that
// proof is valid is decided SERVER-SIDE (src/lib/wallet/verify), so a buggy connector can only
// cause a verification to fail — never a false pass. That's why this layer is not security-
// critical and can evolve freely.

export interface SignResult {
  pubkey: string; // hex G1 public key
  signature: string; // hex BLS12-381 G2 signature
  signingMode?: string; // CHIP-0002 signing mode reported by the wallet
}

export interface WalletConnector {
  readonly id: string; // "sage" | future wallets
  // True only when the connector is actually usable (e.g. a WalletConnect project id is set).
  readonly available: boolean;
  // Begin a session. `onUri` receives the WalletConnect pairing URI to show the user (they paste
  // it into Sage → Settings → WalletConnect, per docs.chia.net). Resolves with the linked address.
  connect(onUri?: (uri: string) => void): Promise<{ address: string }>;
  // Ask the connected wallet to sign our challenge message for `address` (CHIP-0002).
  signMessageByAddress(address: string, message: string): Promise<SignResult>;
  disconnect(): Promise<void>;
}

export class WalletConnectUnavailableError extends Error {
  constructor(message = "Sage connect isn't set up yet. See WALLET_SETUP.md.") {
    super(message);
    this.name = "WalletConnectUnavailableError";
  }
}
