import type { Metadata } from "next";
import "./globals.css";
import { SessionProviderWrapper } from "@/components/auth/SessionProviderWrapper";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Chia NFT Collector Platform",
  description: "A collector-first home for Chia NFT collections, starting with Misfitz.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProviderWrapper>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
