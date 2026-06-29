import type { SignResult, WalletConnector } from "./types";
import { WalletConnectUnavailableError } from "./types";

// Sage connector over WalletConnect v2 (the flow Sage supports: docs.chia.net WalletConnect user
// guide). The @walletconnect/sign-client dependency is loaded at RUNTIME via a non-literal import
// so the project typechecks/builds even before it's installed — see WALLET_SETUP.md for the
// `npm install` + project-id steps. Until configured, `available` is false and the UI offers the
// manual paste path instead.
//
// Not security-critical: the proof this produces is verified independently on the server.

const PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";
const CHAIN = process.env.NEXT_PUBLIC_WC_CHAIN ?? "chia:mainnet";
const METHODS = ["chia_signMessageByAddress", "chia_getCurrentAddress", "chia_logIn"];

async function loadSignClient(): Promise<unknown> {
  // Non-literal specifier: tsc won't try to resolve it, so the repo stays green pre-install.
  const spec = "@walletconnect/sign-client";
  const mod = (await import(spec)) as { SignClient?: unknown; default?: unknown };
  return mod.SignClient ?? mod.default;
}

class SageConnector implements WalletConnector {
  readonly id = "sage";
  readonly available = PROJECT_ID.length > 0;

  // Loosely typed because the SDK is loaded dynamically; correctness is enforced server-side.
  private client: any = null;
  private session: any = null;

  private async ensureClient(): Promise<void> {
    if (!this.available) throw new WalletConnectUnavailableError();
    if (this.client) return;
    const SignClient: any = await loadSignClient().catch(() => {
      throw new WalletConnectUnavailableError(
        "WalletConnect isn't installed. Run the install step in WALLET_SETUP.md.",
      );
    });
    this.client = await SignClient.init({
      projectId: PROJECT_ID,
      metadata: {
        name: "Misfitz Platform",
        description: "Chia NFT collector platform",
        url: typeof window !== "undefined" ? window.location.origin : "https://misfitz.local",
        icons: [],
      },
    });
  }

  async connect(onUri?: (uri: string) => void): Promise<{ address: string }> {
    await this.ensureClient();
    const { uri, approval } = await this.client.connect({
      requiredNamespaces: { chia: { chains: [CHAIN], methods: METHODS, events: [] } },
    });
    if (uri && onUri) onUri(uri);
    this.session = await approval();

    // Chia WalletConnect accounts are fingerprints, not addresses — ask the wallet for the address.
    const address: string = await this.client.request({
      topic: this.session.topic,
      chainId: CHAIN,
      request: { method: "chia_getCurrentAddress", params: {} },
    });
    return { address };
  }

  async signMessageByAddress(address: string, message: string): Promise<SignResult> {
    if (!this.session) throw new WalletConnectUnavailableError("Connect a wallet first.");
    const res: any = await this.client.request({
      topic: this.session.topic,
      chainId: CHAIN,
      request: { method: "chia_signMessageByAddress", params: { message, address } },
    });
    return { pubkey: res.pubkey, signature: res.signature, signingMode: res.signingMode };
  }

  async disconnect(): Promise<void> {
    if (this.client && this.session) {
      try {
        await this.client.disconnect({
          topic: this.session.topic,
          reason: { code: 6000, message: "User disconnected" },
        });
      } catch {
        /* ignore */
      }
    }
    this.session = null;
  }
}

let cached: SageConnector | null = null;
export function getSageConnector(): SageConnector {
  return (cached ??= new SageConnector());
}
