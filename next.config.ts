import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Output standalone untuk Docker (Sprint Portable VPS & Docker V2):
  // .next/standalone/server.js bisa jalan tanpa seluruh node_modules repo.
  output: "standalone",
  /* config options here */
  experimental: {
    agentFeedback: true,
    agentUpgrade: "security",
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
