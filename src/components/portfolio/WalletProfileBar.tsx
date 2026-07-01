"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSavedWallets } from "@/lib/portfolio/useSavedWallets";
import { parseOwnerIds } from "@/lib/wallet/ownerId";
import { useThemeMode } from "@/components/theme/ThemeProvider";

// No-login profile bar for the binder. Paste one or many xch1…/did:chia… ids, see them as removable
// chips, and Save them as a device-local profile that auto-loads on return. The loaded set lives in
// the URL (?address=a,b,c) so it stays shareable and server-rendered; saving just persists it locally.
function shortId(id: string) {
  const body = id.startsWith("did:chia") ? id.slice(id.indexOf("1") + 1) : id.replace(/^xch1/, "");
  const head = id.startsWith("did:chia") ? "did:chia…" : "xch1…";
  return `${head}${body.slice(-6)}`;
}

export function WalletProfileBar({ loaded }: { loaded: string[] }) {
  const router = useRouter();
  const { wallets: saved, hydrated, save, clear } = useSavedWallets();
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const [navigating, startNav] = useTransition();
  const autoloadedRef = useRef(false);

  // First visit of this mount with nothing loaded but a saved profile present -> open it once.
  useEffect(() => {
    if (!hydrated || autoloadedRef.current) return;
    autoloadedRef.current = true;
    if (loaded.length === 0 && saved.length > 0) {
      setRedirecting(true);
      router.replace(`/binder?address=${encodeURIComponent(saved.join(","))}`);
    }
  }, [hydrated, loaded.length, saved, router]);

  function go(ids: string[]) {
    startNav(() => {
      if (ids.length === 0) router.push("/binder");
      else router.push(`/binder?address=${encodeURIComponent(ids.join(","))}`);
    });
  }
  function addDraft() {
    const add = parseOwnerIds(draft);
    if (add.length === 0) {
      setError("That doesn\u2019t look like a Chia wallet. Paste an xch1\u2026 address or a did:chia\u2026 profile id (copied in full).");
      return;
    }
    setError("");
    setDraft("");
    go([...new Set([...loaded, ...add])]);
  }
  const removeWallet = (id: string) => go(loaded.filter((x) => x !== id));

  const isSaved = useMemo(
    () => saved.length > 0 && saved.length === loaded.length && loaded.every((id) => saved.includes(id)),
    [saved, loaded],
  );
  const savedDiffers = useMemo(
    () => saved.length > 0 && !isSaved,
    [saved, isSaved],
  );

  const cardBg = isLight ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.03)";
  const cardBorder = isLight ? "1px solid rgba(41,128,200,0.35)" : "1px solid rgba(255,255,255,0.08)";
  const chipBg = isLight ? "rgba(41,128,200,0.10)" : "rgba(255,255,255,0.06)";
  const chipText = isLight ? "#0a1e38" : "rgba(255,255,255,0.8)";

  if (redirecting || navigating) {
    return (
      <div className="mx-2 mb-4 flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: cardBg, border: cardBorder }}>
        <div className="h-5 w-5 shrink-0 animate-spin rounded-full" style={{ border: "2px solid var(--card-border)", borderTopColor: "transparent" }} />
        <span className="text-sm text-subtle">Loading your binder…</span>
      </div>
    );
  }

  return (
    <div className="mx-2 mb-4 rounded-xl px-4 py-3" style={{ background: cardBg, border: cardBorder }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-subtle">
          Your wallets{loaded.length > 0 ? ` · ${loaded.length}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {isSaved && (
            <>
              <span className="text-[11px] font-semibold" style={{ color: isLight ? "#1a7f3c" : "#34d399" }}>
                ✓ Saved on this device
              </span>
              <button type="button" onClick={clear} className="text-[11px] font-semibold text-subtle underline hover:opacity-80">
                Forget
              </button>
            </>
          )}
          {!isSaved && loaded.length > 0 && (
            <button
              type="button"
              onClick={() => save(loaded)}
              className="rounded-full px-3 py-1 text-[11px] font-bold text-black transition hover:opacity-90"
              style={{ background: isLight ? "#1a7f3c" : "#34d399" }}
            >
              Save profile
            </button>
          )}
        </div>
      </div>

      {/* Paste box */}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (error) setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraft(); } }}
          placeholder="Paste a Chia address (xch1…) or DID (did:chia…) — add as many as you like"
          spellCheck={false}
          className="text-title flex-1 rounded-lg px-4 py-2.5 font-mono text-sm outline-none"
          style={{ background: isLight ? "#ffffff" : "rgba(255,255,255,0.04)", border: cardBorder }}
        />
        <button
          type="button"
          onClick={addDraft}
          disabled={draft.trim().length === 0}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-40"
          style={{ background: isLight ? "#2980c8" : "rgba(56,189,248,0.95)" }}
        >
          Add
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[12px] font-semibold" style={{ color: isLight ? "#aa1111" : "#f87171" }}>
          {error}
        </p>
      )}

      {/* Loaded wallet chips */}
      {loaded.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {loaded.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px]"
              style={{ background: chipBg, color: chipText }}
              title={id}
            >
              {shortId(id)}
              <button
                type="button"
                onClick={() => removeWallet(id)}
                aria-label={`Remove ${id}`}
                className="text-subtle hover:opacity-70"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Contextual hints */}
      {savedDiffers && (
        <button
          type="button"
          onClick={() => go(saved)}
          className="mt-2 text-[11px] font-semibold underline text-subtle hover:opacity-80"
        >
          Load my saved wallets ({saved.length})
        </button>
      )}
      {loaded.length === 0 && saved.length === 0 && hydrated && (
        <p className="mt-2 text-[12px] text-subtle">
          Paste your wallet(s) above to see every NFT you own in one binder — then Save to skip this next time. No account needed.
        </p>
      )}
    </div>
  );
}
