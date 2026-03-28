import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Tell Turbopack this app's root is its own directory,
  // not the parent BengalOracle monorepo root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
