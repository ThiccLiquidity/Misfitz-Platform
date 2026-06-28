"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

// Account auth and wallet status are deliberately separate concerns (ARCHITECTURE.md §5) —
// this bar only reflects account session state; wallet status will be added alongside it later.
export function NavBar() {
  const { data: session, status } = useSession();

  return (
    <header className="flex items-center justify-between border-b border-page-border px-4 py-3 md:px-8">
      <Link href="/collections/misfitz" className="text-title text-sm font-semibold">
        Chia NFT Collector Platform
      </Link>
      <nav className="flex items-center gap-3">
        <ThemeToggle />
        {status === "authenticated" ? (
          <>
            <Link href="/profile" className="text-subtle text-xs hover:opacity-80">
              {session.user?.email}
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/collections/misfitz" })}
              type="button"
              className="text-subtle text-xs hover:opacity-80"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-subtle text-xs hover:opacity-80">
              Log in
            </Link>
            <Link href="/signup" className="text-subtle text-xs hover:opacity-80">
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
