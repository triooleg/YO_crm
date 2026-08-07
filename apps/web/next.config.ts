import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.API_INTERNAL_BASE_URL ?? "http://api:4500/api"}/:path*`
    }];
  }
};

export default config;
