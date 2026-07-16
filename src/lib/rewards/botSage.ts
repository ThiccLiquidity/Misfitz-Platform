// $CHIPS payout bot — Sage wallet ADAPTER (live send only; the operator's machine). Implements WalletRpc by
// talking to the local Sage wallet RPC. Holds NO keys itself — Sage holds the keys and signs; this only asks it
// to send a CAT to an address and reports back the transaction id.
//
// IMPORTANT: the exact Sage RPC method names / body shape below are a best-effort skeleton and MUST be confirmed
// against your installed Sage version's RPC docs before the first LIVE send (dry-run `preview` never calls this).
// Everything is isolated in `rpc()` + the three methods so finalizing the calls is a 3-line change. Until you
// confirm, set no `sage.confirmed` and a live send fails safely with a clear message.
import type { WalletRpc } from "./botDeps";

interface SageCfg { rpcUrl: string; apiKey?: string; feeMojos?: string }

export class SageWallet implements WalletRpc {
  constructor(private readonly cfg: SageCfg) {}

  // One JSON POST to the Sage RPC. Sage runs a local HTTP RPC; adjust the path/headers to match your version.
  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.cfg.rpcUrl.replace(/\/$/, "")}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Sage RPC ${method} -> HTTP ${res.status} ${await res.text().catch(() => "")}`);
    return (await res.json()) as T;
  }

  // Send `amountUnits` of CAT `assetId` to `toWallet`, tagging the paymentKey as a memo for crash-recovery lookup.
  // TODO-CONFIRM: Sage's send-CAT method name + field names (asset_id / address / amount / memos / fee).
  async sendCat(p: { assetId: string; toWallet: string; amountUnits: bigint; dedupeTag: string }): Promise<{ txId: string }> {
    const out = await this.rpc<{ transaction_id?: string; tx_id?: string; error?: string }>("send_cat", {
      asset_id: p.assetId,
      address: p.toWallet,
      amount: p.amountUnits.toString(),
      memos: [p.dedupeTag],
      fee: this.cfg.feeMojos ?? "0",
    });
    const txId = out.transaction_id ?? out.tx_id;
    if (!txId) throw new Error(`Sage send_cat returned no transaction id${out.error ? `: ${out.error}` : ""}`);
    return { txId };
  }

  // Poll until the tx is confirmed on-chain or the budget runs out. TODO-CONFIRM: Sage's tx-status method/fields.
  async waitConfirmed(txId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const s = await this.rpc<{ confirmed?: boolean; success?: boolean }>("get_transaction", { transaction_id: txId });
        if (s.confirmed === true) return true;
      } catch { /* transient — retry until the deadline */ }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return false;
  }

  // Crash-recovery: find an already-broadcast tx by its memo (the paymentKey). TODO-CONFIRM the query method.
  async lookupTx(dedupeTag: string): Promise<string | null> {
    try {
      const r = await this.rpc<{ transactions?: { transaction_id?: string; memos?: string[] }[] }>("get_transactions", { memo: dedupeTag });
      const hit = (r.transactions ?? []).find((t) => (t.memos ?? []).includes(dedupeTag));
      return hit?.transaction_id ?? null;
    } catch {
      return null; // no lookup -> the orchestrator halts on any orphaned "intended" (safe: never auto-resends)
    }
  }
}
