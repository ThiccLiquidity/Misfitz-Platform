"use client";

import { useState } from "react";
import { PP_LOGO_URL } from "@/lib/tang/tang";

// The $PP (Peel Points) token logo — the official Dexie-hosted CAT icon, with a 🍊 fallback if it fails to load.
export function PpLogo({ size = 20, className, title = "Peel Points" }: { size?: number; className?: string; title?: string }) {
  const [err, setErr] = useState(false);
  if (err) return <span title={title} className={className} style={{ fontSize: size, lineHeight: 1 }}>🍊</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={PP_LOGO_URL}
      alt="Peel Points"
      title={title}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErr(true)}
      className={className}
      style={{ borderRadius: "50%", display: "inline-block", verticalAlign: "middle" }}
    />
  );
}
