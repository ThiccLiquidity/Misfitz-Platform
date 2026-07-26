/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Mock data source serves placeholder images from /public. Live MintGarden NFTs are served
    // from MintGarden's asset CDN + IPFS gateway.
    // NFT art comes from arbitrary on-chain hosts (MintGarden CDN, but also IPFS gateways, Arweave,
    // and project-run CDNs via the data_uris fallback). A production build hard-errors on any image
    // host not listed here, so we allow all https hosts. (If optimizer cost/abuse ever matters, narrow
    // this to known gateways or switch NFT <Image>s to unoptimized — see LAUNCH-READINESS.md.)
    // Every external NFT <Image> in this app already passes `unoptimized`, so the optimizer was doing no
    // work for us while `hostname: "**"` left /_next/image?url=<anything> publicly callable - a server-side
    // fetch of an arbitrary https URL, billed per transformation and cache-bustable via w/q params.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "assets.mintgarden.io" },
      { protocol: "https", hostname: "api.mintgarden.io" },
    ],
  },
};

export default nextConfig;
