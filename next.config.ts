import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Keep the dev-mode "N" bubble out of the UI and screenshots.
  devIndicators: false,
  // Self-contained server (.next/standalone) for the Docker image: smaller image, lower memory.
  output: "standalone",
  poweredByHeader: false,
  // Profile photos (validated to 5 MB server-side) are posted through server actions.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // The page CSP (with a per-request nonce) is set in src/middleware.ts.
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders({ production: process.env.NODE_ENV === "production" }) }];
  },
};

export default nextConfig;
