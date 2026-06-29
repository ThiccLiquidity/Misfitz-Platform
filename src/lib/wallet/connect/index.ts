import type { WalletConnector } from "./types";
import { getSageConnector } from "./sage";

export type { WalletConnector, SignResult } from "./types";
export { WalletConnectUnavailableError } from "./types";

// Only Sage is wired today. Goby is intentionally deferred: Chia Network issued a security notice
// flagging the Goby extension in relation to the Raccoon Stealer v2 malware, so we don't steer
// users to connect it until that's clearly resolved (ARCHITECTURE.md §6). A future safe wallet
// slots in here without touching the UI.
export function getWalletConnector(_id = "sage"): WalletConnector {
  return getSageConnector();
}
