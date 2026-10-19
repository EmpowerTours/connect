import type { Metadata } from "next";
import { APP_FULL_NAME, APP_NAME, APP_URL } from "./brand";

/**
 * Pages meant for search engines and link previews: the sign-in page and the public signed-graph
 * explorer, plus the profile and post pages below. Everything else needs a session, or is an API,
 * upload or auth endpoint (src/app/robots.ts).
 */
export const PUBLIC_PATHS = ["/login", "/graph"] as const;

/**
 * Route prefixes readable signed out: one per folder in src/app/(open) (tests/seo.test.ts keeps
 * this list in sync). Members see them inside the app shell, visitors with a sign-in prompt.
 */
export const PUBLIC_PREFIXES = ["/u/", "/post/"] as const;

/** One line used for the meta description and link previews (Open Graph / X cards). */
export const SITE_DESCRIPTION = "The professional network for institutional blockchain business development.";

/** Root layout metadata (src/app/layout.tsx). The preview image is src/app/opengraph-image.tsx. */
export const ROOT_METADATA: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(APP_URL),
  // Canonicals are set per public page (/login, /graph); a site-wide one would point every page at "/".
  applicationName: APP_FULL_NAME,
  openGraph: { type: "website", siteName: APP_FULL_NAME, title: APP_FULL_NAME, description: SITE_DESCRIPTION, locale: "en_US", alternateLocale: ["es_MX"] },
  twitter: { card: "summary_large_image", title: APP_FULL_NAME, description: SITE_DESCRIPTION },
};

/**
 * Member-only route prefixes: one per folder in src/app/(app) (tests/seo.test.ts keeps this list
 * in sync). Listed one by one instead of disallowing "/", because "/" is the URL people share:
 * a crawler that may not fetch it (X's card crawler honours robots.txt) shows no preview at all.
 * Signed-out visitors to "/" are redirected to /login, which is public. Profiles and posts are
 * public (PUBLIC_PREFIXES), so they are not listed here.
 */
export const MEMBER_PATHS = [
  "/admin",
  "/channels",
  "/circle",
  "/compose",
  "/directory",
  "/import",
  "/intros",
  "/more",
  "/opportunities",
  "/orgs",
  "/pipeline",
  "/profile",
  "/search",
  "/signals",
  "/sync",
  "/updates",
] as const;

/** Never crawled. */
export const DISALLOWED_PATHS = ["/api/", "/auth/", "/media/", "/welcome", ...MEMBER_PATHS] as const;

/** Longest description used in link previews. */
export const DESCRIPTION_MAX = 200;

/** One line for a meta description: whitespace collapsed, cut on a word with an ellipsis. */
export function snippet(text: string, max = DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join("");
  const word = cut.replace(/\s+\S*$/, "");
  return `${(word.length > max / 2 ? word : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/**
 * Metadata for a public page (profile, post): its own canonical and preview text. Open Graph and
 * X fields are replaced as a whole by Next, so the site name and locale are repeated here. The
 * preview image comes from the segment's opengraph-image.tsx. `index: false` keeps a page out of
 * search results (demo accounts, unfinished profiles) while links to it still preview.
 */
export function publicPageMetadata(p: {
  title: string;
  description: string;
  path: string;
  type: "profile" | "article";
  index: boolean;
  publishedTime?: Date;
}): Metadata {
  const description = snippet(p.description) || SITE_DESCRIPTION;
  return {
    title: p.title,
    description,
    alternates: { canonical: p.path },
    robots: p.index ? undefined : { index: false, follow: true },
    openGraph: {
      type: p.type,
      siteName: APP_FULL_NAME,
      title: p.title,
      description,
      url: p.path,
      locale: "en_US",
      alternateLocale: ["es_MX"],
      ...(p.type === "article" && p.publishedTime ? { publishedTime: p.publishedTime.toISOString() } : {}),
    },
    twitter: { card: "summary_large_image", title: p.title, description },
  };
}

/** Whether a member's profile and posts belong in search results and the sitemap. */
export function isIndexableMember(u: { isDemo: boolean; onboardedAt: Date | null }): boolean {
  return !u.isDemo && !!u.onboardedAt;
}

export type SitemapEntry = { url: string; lastModified?: Date; changeFrequency?: "daily" | "weekly" | "monthly" };

/** Static public pages, then indexable profiles and posts (the caller filters with isIndexableMember). */
export function buildSitemap(
  base: string,
  profiles: { handle: string; lastModified?: Date }[],
  posts: { id: string; createdAt: Date }[],
): SitemapEntry[] {
  return [
    ...PUBLIC_PATHS.map((path) => ({ url: `${base}${path}`, changeFrequency: path === "/graph" ? ("daily" as const) : ("monthly" as const) })),
    ...profiles.map((p) => ({ url: `${base}/u/${encodeURIComponent(p.handle)}`, changeFrequency: "weekly" as const, ...(p.lastModified ? { lastModified: p.lastModified } : {}) })),
    ...posts.map((p) => ({ url: `${base}/post/${encodeURIComponent(p.id)}`, lastModified: p.createdAt, changeFrequency: "monthly" as const })),
  ];
}
