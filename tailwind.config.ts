import type { Config } from "tailwindcss";

// Collection theming (accent color, card chrome) is applied via CSS variables set at runtime
// from Collection.themeConfig — see src/lib/theme. Tailwind itself stays collection-agnostic.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "vault-bg": "var(--vault-bg)",
        "page-bg": "var(--page-bg)",
        "page-border": "var(--page-border)",
        "card-bg": "var(--card-bg)",
        "card-border": "var(--card-border)",
        "art-bg": "var(--art-bg)",
        title: "var(--title)",
        subtle: "var(--subtle)",
        good: "var(--good)",
        fair: "var(--fair)",
        bad: "var(--bad)",
      },
      aspectRatio: {
        card: "5 / 7",
      },
    },
  },
  plugins: [],
};

export default config;
