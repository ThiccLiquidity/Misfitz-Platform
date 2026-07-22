import type { Metadata, Viewport } from "next";
import { Righteous, Inter, Caveat, Shantell_Sans } from "next/font/google";
import "./globals.css";
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
// Nostalgia-mode handwriting pair — loaded but only applied under [data-theme="nostalgia"] in globals.css.
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });
const shantell = Shantell_Sans({ subsets: ["latin"], variable: "--font-shantell", display: "swap" });

// Set NEXT_PUBLIC_SITE_URL to the production origin (e.g. https://traitfolio.app) so Open Graph image
// URLs resolve absolutely. Falls back to localhost for dev. (See LAUNCH-READINESS.md.)
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const SITE_DESC =
  "Track your Chia NFT collections, discover new ones, see rarity + estimated value, and flex what you own. Built for collectors.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Traitfolio — The home of digital collecting",
    template: "%s · Traitfolio",
  },
  description: SITE_DESC,
  applicationName: "Traitfolio",
  keywords: ["Chia", "NFT", "collection", "rarity", "MintGarden", "Dexie", "Traitfolio", "collector"],
  icons: { icon: "/brand/logo-mark.png", apple: "/brand/logo-mark.png" },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Traitfolio",
    title: "Traitfolio — The home of digital collecting",
    description: SITE_DESC,
    url: SITE_URL,
    images: [{ url: "/brand/landing-hero.png", alt: "Traitfolio — Chia NFT collector platform" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Traitfolio — The home of digital collecting",
    description: SITE_DESC,
    images: ["/brand/landing-hero.png"],
  },
};

// Explicit mobile viewport. viewportFit:"cover" lets us honour iOS safe-area insets; themeColor tints
// the mobile browser chrome to match our dark/light shells.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0602" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${righteous.variable} ${inter.variable} ${caveat.variable} ${shantell.variable}`}>
      {/* Blocking script — runs before first paint, prevents native form-control flash.
          Reads saved theme and sets color-scheme on <html> so <select> elements
          render in the correct scheme from frame 0, no JS hydration required. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('chia-collector-theme-mode') || 'nostalgia';
            if (t === 'dark') t = 'nostalgia-night';
            if (t === 'light') t = 'nostalgia';
            document.documentElement.style.colorScheme = (t === 'nostalgia-night') ? 'dark' : 'light';
          } catch(e) {}
        `}} />
        <script defer src="/_vercel/insights/script.js" />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
