import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Traitfolio — The home of digital collecting",
    short_name: "Traitfolio",
    description: "Track your Chia NFT collections, rarity, and estimated value. Built for collectors.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0602",
    theme_color: "#0a0602",
    icons: [
      { src: "/brand/logo-mark.png", sizes: "any", type: "image/png", purpose: "any" },
    ],
  };
}
