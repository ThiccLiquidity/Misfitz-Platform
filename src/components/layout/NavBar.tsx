"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { Wordmark } from "@/components/brand/Wordmark";

export function NavBar() {
  const { data: session, status } = useSession();
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  return (
    <header
      className="flex items-center justify-between px-4 py-3 md:px-8"
      style={{
        background: isLight ? "#ffffff" : "rgba(10, 6, 2, 0.85)",
        borderBottom: isLight
          ? "1px solid rgba(41, 128, 200, 0.18)"
          : "1px solid rgba(184, 146, 63, 0.35)",
        boxShadow: isLight
          ? "0 1px 12px rgba(0, 80, 160, 0.08)"
          : "0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <Link href="/" className="flex items-center gap-2 transition hover:opacity-80" aria-label="Traitfolio home">
        <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-7 w-auto" priority />
        <Wordmark className="text-lg" />
      </Link>

      <nav className="flex items-center gap-3">
        <Link
          href="/browse"
          className="hidden text-xs font-semibold transition hover:opacity-70 sm:inline"
          style={{ color: isLight ? "#2d5a8e" : "var(--subtle)" }}
        >
          Browse Collections
        </Link>
        <ThemeToggle />
        {status === "authenticated" ? (
          <>
            <Link
              href="/profile"
              className="hidden sm:inline text-xs hover:opacity-70 transition"
              style={{ color: isLight ? "#2d5a8e" : "var(--subtle)" }}
            >
              {session.user?.email}
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              type="button"
              className="text-xs hover:opacity-70 transition"
              style={{ color: isLight ? "#2d5a8e" : "var(--subtle)" }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="text-xs hover:opacity-70 transition"
              style={{ color: isLight ? "#2d5a8e" : "var(--subtle)" }}
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, #2980c8 0%, #1a5fa0 100%)" }}
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
