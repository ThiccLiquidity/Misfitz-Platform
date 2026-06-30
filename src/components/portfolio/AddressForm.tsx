"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Client input for the binder / value view: navigates to ?address=… so the result is a shareable,
// server-rendered URL. Accepts an xch1… address or a did:chia… profile id. useTransition tracks the
// navigation so the button's "Loading…" clears once the new page resolves (a plain boolean would
// stay stuck, since navigating to the same route never unmounts this form).
export function AddressForm({ initial = "", path = "/portfolio", buttonLabel = "Value my NFTs" }: { initial?: string; path?: string; buttonLabel?: string }) {
  const router = useRouter();
  const [address, setAddress] = useState(initial);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = address.trim();
    if (v.length < 8) return;
    startTransition(() => {
      router.push(`${path}?address=${encodeURIComponent(v)}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Paste a Chia address (xch1…) or DID (did:chia…)"
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
