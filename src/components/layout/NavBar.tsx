"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { Wordmark } from "@/components/brand/Wordmark";

// Top nav. The product is no-login (paste/save wallets locally), so the bar is just wayfinding:
// Browse (discovery) + Your Binder (your collection) + theme toggle. The old Log in / Sign up cluster
// was removed — it wasn't wired to the no-login flow and only added clutter.
const LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/binder", label: "Your Binder" },
];

export function NavBar() {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const pathname = usePathname();
  const linkColor = isLight ? "#2d5a8e" : "var(--subtle)";
  const activeColor = isLight ? "#0a1e38" : "var(--title)";

  return (
    <header
      className="flex items-center justify-between px-4 py-3 md:px-8"
      style={{
        background: isLight ? "#ffffff" : "rgba(10, 6, 2, 0.85)",
        borderBottom: isLight ? "1px solid rgba(41, 128, 200, 0.18)" : "1px solid rgba(184, 146, 63, 0.35)",
        boxShadow: isLight ? "0 1px 12px rgba(0, 80, 160, 0.08)" : "0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <Link href="/" className="flex items-center gap-2 transition hover:opacity-80" aria-label="Traitfolio home">
        <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-7 w-auto" priority />
        <Wordmark className="text-lg" />
      </Link>

      <nav className="flex items-center gap-4">
        {LINKS.map((l) => {
          const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-semibold transition hover:opacity-70"
              style={{ color: active ? activeColor : linkColor }}
            >
              {l.label}
            </Link>
          );
        })}
        <ThemeToggle />
      </nav>
    </header>
  );
}
