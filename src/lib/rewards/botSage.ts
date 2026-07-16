// $CHIPS payout bot — Sage wallet ADAPTER (live send only; the operator's machine). Implements WalletRpc by
// talking to the local Sage wallet RPC. Holds NO keys itself — Sage holds the keys and signs; this only asks it
// to send a CAT to an address and reports back the transaction id.
//
// IMPORTANT: the exact Sage RPC method names / body shape below are a best-effort skeleton and MUST be confirmed
// against your installed Sage version's RPC docs before the first LIVE send (dry-run `preview` never calls this).
// Everything is isolated in `rpc()` + the three methods so finalizing the calls is a 3-line change. Until you
// confirm, set no `sage.confirmed` and a live send fails safely with a clear message.
import type { WalletRpc } from "./botDeps";

interface SageCfg { rpcUrl: string; apiKey?: string; feeMojos?: string; fingerprint?: string }

export class SageWallet implements WalletRpc {
  constructor(private readonly cfg: SageCfg) {}

  // ---- WALLET PIN (fail-closed). Sage's RPC spends from whatever key is LOGGED IN — send_cat takes no
  // fingerprint/wallet selector — so an open personal wallet would otherwise be spendable. preflight() throws
  // (and the orchestrator halts, sending nothing) unless Sage's ACTIVE fingerprint equals cfg.fingerprint.
  // Every failure mode is a throw: no pin configured, probe errored, fingerprint missing/unparseable, mismatch.
  // sendCat() re-asserts the pin per send, so switching profiles in Sage MID-RUN also halts (TOCTOU).

  // TODO-CONFIRM: the Sage method that reports the active (logged-in) key. Verify against your installed
  // Sage version's RPC docs — likely candidates: `get_key` ({} -> { key: { fingerprint } }) or a
  // `get_logged_in_fingerprint`-style call. A wrong guess here fails CLOSED (HTTP error -> throw -> halt).
  private async activeFingerprint(): Promise<string> {
    const out = await this.rpc<{ key?: { fingerprint?: number | string }; fingerprint?: number | string }>("get_key", {});
    const fp = out.key?.fingerprint ?? out.fingerprint;
    if ((typeof fp !== "number" && typeof fp !== "string") || String(fp).trim() === "") {
      throw new Error("Sage did not report an active key fingerprint");
    }
    return String(fp).trim();
  }

  async preflight(): Promise<void> {
    const want = this.cfg.fingerprint?.trim();
    if (!want) throw new Error("sage.fingerprint is not configured — refusing to send (pin the designated distribution wallet in bot-config.json)");
    let got: string;
    try { got = await this.activeFingerprint(); }
    catch (e) { throw new Error(`cannot confirm Sage's active wallet (${(e as Error)?.message ?? String(e)}) — refusing to send`); }
    if (got !== want) throw new Error(`Sage's active wallet fingerprint ${got} is NOT the designated distribution wallet ${want} — refusing to send (log in to the distribution wallet in Sage, or fix sage.fingerprint)`);
  }

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
    await this.preflight(); // re-assert the wallet pin on EVERY send — one extra local RPC per payment is cheap
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
