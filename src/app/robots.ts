import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/brand";
import { DISALLOWED_PATHS, PUBLIC_PATHS, PUBLIC_PREFIXES } from "@/lib/seo";

/** Crawl only the public pages and profiles/posts (src/lib/seo.ts); member pages and /api stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [...PUBLIC_PATHS, ...PUBLIC_PREFIXES],
      disallow: [...DISALLOWED_PATHS],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
