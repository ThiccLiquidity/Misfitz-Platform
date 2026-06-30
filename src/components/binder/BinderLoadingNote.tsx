"use client";

import { useEffect, useState } from "react";

// Sub-line on the binder loading screen telling the user which wallet(s) are being read. Reads the URL
// after mount (no useSearchParams -> no Suspense requirement); purely cosmetic, safe if it renders the
// generic fallback.
function shortId(id: string) {
  if (id.startsWith("did:chia")) return `${id.slice(0, 10)}…${id.slice(-5)}`;
  return `${id.slice(0, 9)}…${id.slice(-5)}`;
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
      {label ? `Reading ${label} from the Chia blockchain…` : "Reading your wallet from the Chia blockchain…"}
    </div>
  );
}
