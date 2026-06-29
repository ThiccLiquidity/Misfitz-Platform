"use client";

import { useState } from "react";
import Link from "next/link";
import { truncateAddress } from "@/lib/format";
import { getWalletConnector } from "@/lib/wallet/connect";

export interface WalletRow {
  id: string;
  address: string;
  label: string | null;
  walletType: string | null;
  verifiedAt: string | null;
}

// Profile wallet linking + Phase 2 verification (ARCHITECTURE.md §6). Verified wallets unlock
// badges and artist airdrop eligibility — distinct from the no-login "see my NFT value" path.
//
// Three ways to verify, in order of preference:
//   1. Connect Sage (WalletConnect) — the real flow when NEXT_PUBLIC_WC_PROJECT_ID is configured.
//   2. Paste an address manually + sign elsewhere (always available).
//   3. Dev "simulate signature" — only meaningful while the server runs the mock verifier.
// Verification itself always runs server-side, so none of these can fake a pass.
export function WalletPanel({ initialWallets }: { initialWallets: WalletRow[] }) {
  const connector = getWalletConnector("sage");

  const [wallets, setWallets] = useState<WalletRow[]>(initialWallets);
  const [address, setAddress] = useState("");
  const [challenge, setChallenge] = useState<{ nonce: string; message: string; address: string } | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
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

  async function requestChallenge(addr: string, walletType: string) {
    const res = await fetch("/api/wallet/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr, walletType }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start verification.");
    upsertWallet({ id: data.walletId, address: data.address, label: null, walletType, verifiedAt: null });
    return data as { nonce: string; message: string; address: string };
  }

  async function verify(nonce: string, addr: string, walletType: string, proof: { pubkey: string; signature: string; signingMode?: string }) {
    const res = await fetch("/api/wallet/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, ...proof }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Verification failed.");
    upsertWallet({ id: "", address: addr, label: null, walletType, verifiedAt: new Date().toISOString() });
    setNotice(`Verified ${truncateAddress(data.address, 8, 4)}`);
  }

  // ── 1. Connect Sage (real WalletConnect flow) ──────────────────────────────
  async function connectSage() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setWcUri(null);
    try {
      const { address: addr } = await connector.connect((uri) => setWcUri(uri));
      setWcUri(null);
      const ch = await requestChallenge(addr, "sage");
      const proof = await connector.signMessageByAddress(ch.address, ch.message);
      await verify(ch.nonce, ch.address, "sage", proof);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect Sage.");
    } finally {
      setBusy(false);
      setWcUri(null);
    }
  }

  // ── 2. Manual paste -> challenge (sign elsewhere or simulate) ───────────────
  async function startManualChallenge() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ch = await requestChallenge(address.trim(), "manual");
      setChallenge(ch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // ── 3. Dev simulate (mock verifier only) ────────────────────────────────────
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
      await verify(challenge.nonce, challenge.address, "manual", proof);
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
            <div className="flex items-center gap-2">
              <Link
                href={`/portfolio?address=${encodeURIComponent(w.address)}`}
                className="text-subtle whitespace-nowrap text-xs underline-offset-2 hover:text-title hover:underline"
              >
                View value
              </Link>
              {w.verifiedAt ? (
                <span className="whitespace-nowrap rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                  Verified
                </span>
              ) : (
                <span className="text-subtle whitespace-nowrap rounded-full bg-white/5 px-2 py-0.5 text-xs">
                  Unverified
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Connect Sage */}
      <div className="mt-5">
        {connector.available ? (
          <button
            type="button"
            disabled={busy}
            onClick={connectSage}
            className="w-full rounded-lg bg-emerald-500/90 px-4 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40 sm:w-auto"
          >
            {busy ? "Connecting…" : "Connect Sage Wallet"}
          </button>
        ) : (
          <p className="text-subtle rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
            Sage connect isn&rsquo;t configured yet (no WalletConnect project id). You can still link an
            address manually below — see WALLET_SETUP.md to enable one-click Sage.
          </p>
        )}

        {wcUri && (
          <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] p-3">
            <p className="text-title text-sm font-medium">Open Sage → Settings → WalletConnect → paste this:</p>
            <pre className="text-subtle mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[11px]">
              {wcUri}
            </pre>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(wcUri).catch(() => {})}
              className="text-subtle mt-2 text-xs underline-offset-2 hover:text-title hover:underline"
            >
              Copy URI
            </button>
          </div>
        )}
      </div>

      {/* Manual link */}
      {!challenge ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-subtle mb-2 text-xs uppercase tracking-wide">Or link an address manually</p>
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
              onClick={startManualChallenge}
              className="text-subtle rounded-lg border border-white/15 px-4 py-2 text-sm transition hover:border-white/30 disabled:opacity-40"
            >
              {busy ? "Working…" : "Get message to sign"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
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
            The dev button works while the server runs the mock verifier. Real Sage/Goby signing
            verifies the same way — server-side.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
    </section>
  );
}
