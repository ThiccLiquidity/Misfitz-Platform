import type { Metadata } from "next";
import { Righteous, Inter } from "next/font/google";
import "./globals.css";
import { SessionProviderWrapper } from "@/components/auth/SessionProviderWrapper";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppShell } from "@/components/layout/AppShell";

const righteous = Righteous({
  subsets: ["latin"],
  variable: "--font-righteous",
  display: "swap",
  weight: "400",
});

// Clean UI/body font. Righteous (a heavy display face) stays reserved for the brand wordmark and a
// few headings (var(--font-righteous)); using it for body text made everything look thick/fuzzy.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Traitfolio — The home of digital collecting",
  description: "Traitfolio — track your Chia NFT collections, discover new ones, and flex what you own. Built for collectors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${righteous.variable} ${inter.variable}`}>
      {/* Blocking script — runs before first paint, prevents native form-control flash.
          Reads saved theme and sets color-scheme on <html> so <select> elements
          render in the correct scheme from frame 0, no JS hydration required. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('chia-collector-theme-mode') || 'dark';
            document.documentElement.style.colorScheme = t === 'dark' ? 'dark' : 'light';
          } catch(e) {}
        `}} />
      </head>
      <body className={inter.className}>
        <SessionProviderWrapper>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
