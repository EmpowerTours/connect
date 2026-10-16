import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/brand";
import { PUBLIC_PATHS } from "@/lib/seo";

/** Public pages only (src/lib/seo.ts). Member pages need a session and are never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: `${APP_URL}${path}`, changeFrequency: path === "/graph" ? "daily" : "monthly" }));
}
