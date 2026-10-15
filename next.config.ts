import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev-mode "N" bubble out of the UI and screenshots.
  devIndicators: false,
  // Profile photos (validated to 5 MB server-side) are posted through server actions.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
