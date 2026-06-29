/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Mock data source serves placeholder images from /public. Live MintGarden NFTs are served
    // from MintGarden's asset CDN + IPFS gateway.
    remotePatterns: [
      { protocol: "https", hostname: "assets.mainnet.mintgarden.io" },
      { protocol: "https", hostname: "assets.mintgarden.io" },
      { protocol: "https", hostname: "ipfs.mintgarden.io" },
    ],
  },
};

export default nextConfig;
