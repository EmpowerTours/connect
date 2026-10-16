/**
 * Pages meant for search engines: the sign-in page and the public signed-graph explorer.
 * Everything else needs a session, or is an API, upload or auth endpoint (src/app/robots.ts).
 */
export const PUBLIC_PATHS = ["/login", "/graph"] as const;

/** Never crawled. "/" is last so the explicit allows above win (longest match). */
export const DISALLOWED_PATHS = ["/api/", "/auth/", "/media/", "/admin", "/welcome", "/"] as const;
