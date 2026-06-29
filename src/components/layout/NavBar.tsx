"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useThemeMode } from "@/components/theme/ThemeProvider";

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
      <Link
        href="/"
        className="text-sm font-black tracking-tight transition hover:opacity-80"
        style={{ color: isLight ? "#0a1e38" : "var(--title)" }}
      >
        {isLight ? (
          <span className="flex items-center gap-2">
            <span
              className="inline-block px-2 py-0.5 rounded-md text-white text-[10px] font-black tracking-widest uppercase"
              style={{ background: "linear-gradient(135deg, #2980c8 0%, #1a5fa0 100%)" }}
            >
              Chia
            </span>
            <span>NFT Collector</span>
          </span>
        ) : (
          "Chia NFT Collector Platform"
        )}
      </Link>

      <nav className="flex items-center gap-3">
        <ThemeToggle />
        <Link
          href="/portfolio"
          className="text-xs font-semibold hover:opacity-70 transition"
          style={{ color: isLight ? "#2d5a8e" : "var(--subtle)" }}
        >
          Value my wallet
        </Link>
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
