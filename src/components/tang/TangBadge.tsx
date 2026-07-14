"use client";

import { tangFor } from "@/lib/tang/tang";

// Small tangerine "Tang Gang · N PP" chip. Renders nothing unless the collection is a Tang Gang collection AND
// the feature flag is on. `variant="corner"` = absolute pill for image corners; "inline" = flows in text.
export function TangBadge({ colId, variant = "inline" }: { colId: string; variant?: "corner" | "inline" }) {
  const tang = tangFor(colId);
  if (!tang) return null;
  const base = "tf-tang-coin rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white";
  const label = `Tang · ${tang.pp.toLocaleString()} PP`;
  if (variant === "corner") {
    return <div className={`absolute left-1.5 top-1.5 z-10 ${base}`} title={`Tang Gang collection · ${tang.pp.toLocaleString()} peel points`}>{label}</div>;
  }
  return <span className={base} title={`Tang Gang collection · ${tang.pp.toLocaleString()} peel points`}>{label}</span>;
}
