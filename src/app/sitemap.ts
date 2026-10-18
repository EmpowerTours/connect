import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/brand";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/error-report";
import { buildSitemap } from "@/lib/seo";

// Read at request time: profiles and posts change, and the build has no database.
export const dynamic = "force-dynamic";

/** Caps that keep the file well under the 50,000-URL sitemap limit. */
const MAX_PROFILES = 5000;
const MAX_POSTS = 5000;

/**
 * Public pages (src/lib/seo.ts), then finished, non-demo profiles and their top-level posts.
 * Member-only pages are never listed. If the database is unreachable, the static pages still go out.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const indexable = { isDemo: false, onboardedAt: { not: null } };
  try {
    const [profiles, posts] = await Promise.all([
      prisma.user.findMany({ where: indexable, select: { handle: true }, orderBy: { createdAt: "desc" }, take: MAX_PROFILES }),
      prisma.post.findMany({ where: { parentId: null, author: indexable }, select: { id: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: MAX_POSTS }),
    ]);
    return buildSitemap(APP_URL, profiles, posts);
  } catch (e) {
    await reportError("sitemap query failed", e, { scope: "seo" });
    return buildSitemap(APP_URL, [], []);
  }
}
