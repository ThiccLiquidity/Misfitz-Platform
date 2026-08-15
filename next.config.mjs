/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Mock data source serves placeholder images from /public. Live MintGarden NFTs are served
    // from MintGarden's asset CDN + IPFS gateway.
    // NFT art comes from arbitrary on-chain hosts (MintGarden CDN, but also IPFS gateways, Arweave,
    // and project-run CDNs via the data_uris fallback). A production build hard-errors on any image
    // host not listed here, so we allow all https hosts. (If optimizer cost/abuse ever matters, narrow
    // this to known gateways or switch NFT <Image>s to unoptimized — see LAUNCH-READINESS.md.)
    // NOTE: `unoptimized: true` was set here and then REVERTED. The claim behind it - "every <Image>
    // already passes unoptimized" - was true of the NFT images and FALSE of the brand images: Landing.tsx
    // has 4 <Image> and only 1 opted out, so a 2MB landing-hero.png and the logo went from optimized WebP
    // to full-size PNG on the most-visited page. Optimizer back ON.
    //
    // The open-proxy problem it was meant to fix is solved by the narrow host list below instead: the
    // optimizer will only fetch from these hosts, so /_next/image?url=<anything-else> is refused. NFT
    // images pass `unoptimized` per-component and bypass the optimizer (and this list) entirely.
    remotePatterns: [
      { protocol: "https", hostname: "assets.mintgarden.io" },
      { protocol: "https", hostname: "api.mintgarden.io" },
    ],
  },
};

export default nextConfig;
