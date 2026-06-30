"use client";

import { useEffect, useState } from "react";

// Tells the user WHICH wallet(s) are being pulled, on the binder loading screen. Reads the URL after
// mount (no useSearchParams, so no Suspense requirement) — purely cosmetic, safe if it renders empty.
function shortId(id: string) {
  if (id.startsWith("did:chia")) return `did:chia…${id.slice(-6)}`;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export function BinderLoadingNote() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("address") ?? "";
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 1) setLabel(shortId(ids[0].toLowerCase()));
    else if (ids.length > 1) setLabel(`${ids.length} wallets`);
  }, []);
  return (
    <div className="text-subtle text-sm">
      {label
        ? `Pulling NFTs for ${label} from the chain — this can take a few seconds.`
        : "Pulling your NFTs from the chain — this can take a few seconds."}
    </div>
  );
}
