import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pg", "pg-cursor"],
  },
};

export default nextConfig;
