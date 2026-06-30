"use client";

import { useCallback, useEffect, useState } from "react";

// Device-local "my wallets" profile: the set of DIDs/addresses a collector saves so the binder
// auto-loads them on return — no account, no login. Stored in localStorage (same pattern as the
// hidden-collections preference). One saved set per device; add/remove/clear.
const KEY = "traitfolio:savedWallets";

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

export function useSavedWallets() {
  const [wallets, setWallets] = useState<string[]>([]);
  // hydrated flag lets callers avoid acting on the empty SSR/first-paint value before storage loads.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setWallets(read());
    setHydrated(true);
  }, []);

  const save = useCallback((next: string[]) => {
    const deduped = [...new Set(next)];
    setWallets(deduped);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(deduped));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, []);

  const clear = useCallback(() => save([]), [save]);

  return { wallets, hydrated, save, clear };
}
