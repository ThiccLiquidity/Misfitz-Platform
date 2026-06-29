"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Client input for the no-login value view: navigates to /portfolio?address=... so the result is
// a shareable, server-rendered URL (no client data-fetching needed).
export function AddressForm({ initial = "", path = "/portfolio", buttonLabel = "Value my NFTs" }: { initial?: string; path?: string; buttonLabel?: string }) {
  const router = useRouter();
  const [address, setAddress] = useState(initial);
  const [pending, setPending] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = address.trim();
    if (v.length < 8) return;
    setPending(true);
    router.push(`${path}?address=${encodeURIComponent(v)}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Paste any Chia address (xch1...)"
        spellCheck={false}
        className="text-title flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-sm outline-none focus:border-emerald-400/40"
      />
      <button
        type="submit"
        disabled={pending || address.trim().length < 8}
        className="rounded-lg bg-emerald-500/90 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40"
      >
        {pending ? "Loading…" : buttonLabel}
      </button>
    </form>
  );
}
