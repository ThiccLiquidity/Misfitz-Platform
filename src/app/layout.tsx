import type { Metadata } from "next";
import { Righteous } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Chia NFT Collector Platform",
  description: "A collector-first home for Chia NFT collections, starting with Misfitz.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={righteous.variable}>
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
      <body className={righteous.className}>
        <SessionProviderWrapper>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
