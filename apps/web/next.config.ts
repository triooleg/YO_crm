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
  async headers() {
    const script = process.env.NODE_ENV === 'development' ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
    return [{source:'/parent-measurements/:path*',headers:[
      {key:'Cache-Control',value:'no-store'},
      {key:'Referrer-Policy',value:'no-referrer'},
      {key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Content-Security-Policy',value:`default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`},
    ]}];
  },
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.API_INTERNAL_BASE_URL ?? "http://api:4500/api"}/:path*`
    }];
  }
};

export default config;
