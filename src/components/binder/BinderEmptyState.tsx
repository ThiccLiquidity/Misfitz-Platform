// Neutral placeholder for the binder before any wallet is loaded — replaces the old seeded-Misfitz
// demo. Purely presentational; the paste box lives above it in WalletProfileBar.
export function BinderEmptyState() {
  return (
    <div
      className="mx-2 mt-2 flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
      style={{ background: "var(--card-bg)", border: "1px dashed var(--card-border)" }}
    >
      <div className="text-4xl" aria-hidden>📒</div>
      <h2 className="text-title mt-3 text-lg font-bold">Your binder is empty</h2>
      <p className="text-subtle mt-2 max-w-md text-sm">
        Paste a Chia address (<span className="font-mono">xch1…</span>) or a DID
        (<span className="font-mono">did:chia…</span>) above to load every NFT you own into one binder —
        sorted by rarity, with an estimated value for each. No account needed, and we&apos;ll remember
        your wallets on this device for next time.
      </p>
    </div>
  );
}
