"use client";

import { useCallback, useEffect, useState } from "react";

// Per-device preference: collections the collector has chosen to hide from their binder (e.g. spam
// airdrops). Stored in localStorage keyed by collection id, so it's reusable by any holdings view
// and survives reloads without a server round-trip. Hidden ids are dropped from the aggregate
// "All" view, totals, tier stats, and counts — but kept listable so they can be restored.
const KEY = "traitfolio:hiddenCollections";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function useHiddenCollections() {
  // Start empty so server and first client render match; hydrate from storage after mount.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setHidden(new Set(read()));
  }, []);

  const write = useCallback((next: Set<string>) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, []);

  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write(next);
      return next;
    });
  }, [write]);

  const clear = useCallback(() => {
    setHidden(() => {
      const next = new Set<string>();
      write(next);
      return next;
    });
  }, [write]);

  return { hidden, toggle, clear };
}
