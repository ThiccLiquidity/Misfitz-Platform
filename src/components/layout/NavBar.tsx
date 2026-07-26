"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Wordmark } from "@/components/brand/Wordmark";

// Top nav. The product is no-login (paste/save wallets locally), so the bar is just wayfinding:
// Browse (discovery) + Your Binder (your collection) + theme toggle. The old Log in / Sign up cluster
// was removed — it wasn't wired to the no-login flow and only added clutter.
const LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/binder", label: "Your Binder" },
];

export function NavBar() {
  const pathname = usePathname();
  const linkColor = "var(--subtle)";
  const activeColor = "var(--title)";

  return (
    <header
      className="tf-navbar flex items-center justify-between gap-2 px-3 py-2.5 md:px-8 md:py-3"
      style={{
        background: "rgba(10, 6, 2, 0.85)",
        borderBottom: "1px solid rgba(184, 146, 63, 0.35)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <Link href="/" className="flex min-w-0 items-center gap-2 transition hover:opacity-80" aria-label="Traitfolio home">
        <Image src="/brand/logo-mark.png" alt="" width={425} height={478} className="h-6 w-auto md:h-7" priority />
        <Wordmark className="text-base md:text-lg" />
      </Link>

      <nav className="flex shrink-0 items-center gap-3 md:gap-4">
        {LINKS.map((l) => {
          const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-[40px] items-center text-sm font-semibold transition hover:opacity-70"
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
