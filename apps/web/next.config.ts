import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), "../../package.json"), "utf8")) as { version: string };

const config: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_CRM_VERSION: process.env.CRM_VERSION ?? rootPackage.version,
    NEXT_PUBLIC_CRM_COMMIT: process.env.CRM_COMMIT ?? "development",
  },
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.API_INTERNAL_BASE_URL ?? "http://api:4500/api"}/:path*`
    }];
  }
};

export default config;
