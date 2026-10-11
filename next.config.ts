import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Copilot screenshots (client-resized, max 3 per message) exceed the 1MB default.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
