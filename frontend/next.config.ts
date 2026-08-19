import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  allowedDevOrigins: ["*.trycloudflare.com"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
