import type { Metadata } from "next";
import { APP_FULL_NAME, APP_NAME, APP_URL } from "./brand";

/**
 * Pages meant for search engines and link previews: the sign-in page and the public signed-graph
 * explorer. Everything else needs a session, or is an API, upload or auth endpoint (src/app/robots.ts).
 */
export const PUBLIC_PATHS = ["/login", "/graph"] as const;

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
 * Signed-out visitors to "/" are redirected to /login, which is public.
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
  "/post/",
  "/profile",
  "/search",
  "/signals",
  "/sync",
  "/u/",
  "/updates",
] as const;

/** Never crawled. */
export const DISALLOWED_PATHS = ["/api/", "/auth/", "/media/", "/welcome", ...MEMBER_PATHS] as const;
