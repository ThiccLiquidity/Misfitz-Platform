"use client";

import { useState } from "react";
import { truncateAddress } from "@/lib/format";

export interface WalletRow {
  id: string;
  address: string;
  label: string | null;
  walletType: string | null;
  verifiedAt: string | null;
}

const WALLET_TYPES = [
  { key: "sage", name: "Sage (WalletConnect)" },
  { key: "goby", name: "Goby (browser)" },
  { key: "manual", name: "Paste only" },
];

// Profile wallet linking + Phase 2 verification (ARCHITECTURE.md §6). Verified wallets are what
// unlock badges and artist airdrop eligibility — distinct from the no-login "see my NFT value"
// path, which needs no account at all.
//
// Flow: pick wallet + paste address -> POST /challenge (gets a single-use message) -> sign it ->
// POST /verify (server-side check) -> wallet shows Verified. While the platform is mock-first, a
// "Simulate signature" action stands in for the real Sage/Goby signing step.
export function WalletPanel({ initialWallets }: { initialWallets: WalletRow[] }) {
  const [wallets, setWallets] = useState<WalletRow[]>(initialWallets);
  const [address, setAddress] = useState("");
  const [walletType, setWalletType] = useState("sage");
  const [challenge, setChallenge] = useState<{ nonce: string; message: string; address: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function upsertWallet(row: WalletRow) {
    setWallets((prev) => {
      const i = prev.findIndex((w) => w.address === row.address);
      if (i === -1) return [...prev, row];
      const next = prev.slice();
      next[i] = { ...next[i], ...row };
      return next;
    });
  }

  async function startChallenge() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/wallet/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), walletType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start verification.");
      setChallenge({ nonce: data.nonce, message: data.message, address: data.address });
      upsertWallet({ id: data.walletId, address: data.address, label: null, walletType, verifiedAt: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function simulateAndVerify() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const sim = await fetch("/api/wallet/simulate-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: challenge.address, message: challenge.message }),
      });
      const proof = await sim.json();
      if (!sim.ok) throw new Error(proof.error ?? "Simulated signing failed.");
      await submitProof(proof.pubkey, proof.signature, proof.signingMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function submitProof(pubkey: string, signature: string, signingMode?: string) {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce: challenge.nonce, pubkey, signature, signingMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed.");
      upsertWallet({ id: "", address: challenge.address, label: null, walletType, verifiedAt: new Date().toISOString() });
      setNotice(`Verified ${truncateAddress(data.address, 8, 4)}`);
      setChallenge(null);
      setAddress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-title text-sm font-semibold uppercase tracking-wide">Wallets</h2>
      <p className="text-subtle mt-1 text-sm">
        Verify a Chia address to claim it on your profile, earn badges, and qualify for artist
        airdrops. Just browsing your NFTs&rsquo; value? You don&rsquo;t need to link anything.
      </p>

      <ul className="mt-4 space-y-2">
        {wallets.length === 0 && <li className="text-subtle text-sm">No wallets linked yet.</li>}
        {wallets.map((w) => (
          <li
            key={w.address}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-title truncate font-mono text-sm">{truncateAddress(w.address, 10, 6)}</div>
              {w.walletType && <div className="text-subtle text-xs capitalize">{w.walletType}</div>}
            </div>
            {w.verifiedAt ? (
              <span className="whitespace-nowrap rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                Verified
              </span>
            ) : (
              <span className="text-subtle whitespace-nowrap rounded-full bg-white/5 px-2 py-0.5 text-xs">
                Unverified
              </span>
            )}
          </li>
        ))}
      </ul>

      {!challenge ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            {WALLET_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setWalletType(t.key)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  walletType === t.key
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                    : "text-subtle border-white/10 hover:border-white/25"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="xch1..."
              spellCheck={false}
              className="text-title flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400/40"
            />
            <button
              type="button"
              disabled={busy || address.trim().length < 8}
              onClick={startChallenge}
              className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40"
            >
              {busy ? "Working…" : "Link & verify"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-title text-sm font-medium">Sign this message in your wallet to prove ownership:</p>
          <pre className="text-subtle max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3 text-xs">
            {challenge.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={simulateAndVerify}
              className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40"
            >
              {busy ? "Verifying…" : "Simulate signature (dev)"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setChallenge(null);
                setError(null);
              }}
              className="text-subtle rounded-lg border border-white/10 px-4 py-2 text-sm transition hover:border-white/25"
            >
              Cancel
            </button>
          </div>
          <p className="text-subtle text-xs">
            Sage and Goby signing will replace the dev button once live. Verification always runs
            server-side.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
    </section>
  );
}
