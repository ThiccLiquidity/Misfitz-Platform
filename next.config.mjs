/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Mock data source serves placeholder images from /public. Live MintGarden NFTs are served
    // from MintGarden's asset CDN + IPFS gateway.
    // NFT art comes from arbitrary on-chain hosts (MintGarden CDN, but also IPFS gateways, Arweave,
    // and project-run CDNs via the data_uris fallback). A production build hard-errors on any image
    // host not listed here, so we allow all https hosts. (If optimizer cost/abuse ever matters, narrow
    // this to known gateways or switch NFT <Image>s to unoptimized — see LAUNCH-READINESS.md.)
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
