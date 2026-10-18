import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { APP_URL } from "@/lib/brand";
import { MEMBER_PATHS, ROOT_METADATA as metadata } from "@/lib/seo";

function rule() {
  const r = robots();
  return Array.isArray(r.rules) ? r.rules[0] : r.rules;
}
const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
/** robots.txt prefix match (no wildcards are used here). */
const blocked = (p: string) => asList(rule().disallow).some((d) => p.startsWith(d));

describe("robots and sitemap", () => {
  it("robots disallows /api, auth, uploads and onboarding, allows only public pages, points at the sitemap", () => {
    const r = robots();
    expect(rule().disallow).toEqual(expect.arrayContaining(["/api/", "/auth/", "/media/", "/welcome", "/admin"]));
    expect(rule().allow).toEqual(["/login", "/graph"]);
    expect(r.sitemap).toBe("https://connect.empowertours.xyz/sitemap.xml");
  });

  it("disallows every member route folder in src/app/(app)", () => {
    const dir = path.join(process.cwd(), "src/app/(app)");
    const routes = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      expect(blocked(`/${r}`) || blocked(`/${r}/x`), `/${r} must be in MEMBER_PATHS`).toBe(true);
      expect(MEMBER_PATHS.some((p) => p.replace(/\/$/, "") === `/${r}`), `/${r} must be in MEMBER_PATHS`).toBe(true);
    }
    for (const p of ["/admin", "/profile", "/pipeline", "/intros", "/u/ana", "/post/1", "/api/auth/session", "/media/a.webp"]) expect(blocked(p), p).toBe(true);
  });

  it("lets crawlers reach the shared root, the public pages and the preview image", () => {
    for (const p of ["/", "/login", "/graph", "/graph/abc", "/opengraph-image"]) expect(blocked(p), p).toBe(false);
  });

  it("sitemap lists only public pages on the canonical host", () => {
    const urls = sitemap().map((e) => e.url);
    expect(APP_URL).toBe("https://connect.empowertours.xyz");
    expect(urls).toEqual([`${APP_URL}/login`, `${APP_URL}/graph`]);
    for (const private_ of ["/admin", "/profile", "/pipeline", "/intros", "/api"]) expect(urls.some((u) => u.includes(private_))).toBe(false);
  });
});

describe("link previews", () => {
  it("root metadata has Open Graph and X card tags and no site-wide canonical", () => {
    expect(metadata.openGraph).toMatchObject({ type: "website", title: "EmpowerTours Connect" });
    expect(metadata.openGraph?.description).toBeTruthy();
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    // A canonical on the root layout would mark every page (including /login and /graph) as a copy of "/".
    expect(metadata.alternates?.canonical).toBeUndefined();
  });
});
