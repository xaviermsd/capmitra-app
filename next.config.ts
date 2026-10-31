import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Hide the Next.js "N" developer badge (it only shows in npm run dev and covers the timeline labels).
  devIndicators: false,
  // Let other PCs on your network open the dev server (npm run dev).
  // Add your PC's IP here if it changes. Note: MP4 export needs localhost or https.
  allowedDevOrigins: ["192.168.1.2", "192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
