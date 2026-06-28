/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Mock data source serves placeholder images from /public for now.
    // Live MintGarden integration will add its CDN hostname here.
    remotePatterns: [],
  },
};

export default nextConfig;
