import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { APP_URL } from "@/lib/brand";
import { publicUserSelect } from "@/lib/public-fields";
import { buildSitemap, isIndexableMember, MEMBER_PATHS, PUBLIC_PREFIXES, publicPageMetadata, ROOT_METADATA as metadata, snippet } from "@/lib/seo";

function rule() {
  const r = robots();
  return Array.isArray(r.rules) ? r.rules[0] : r.rules;
}
const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
/** robots.txt prefix match (no wildcards are used here). */
const blocked = (p: string) => asList(rule().disallow).some((d) => p.startsWith(d));
const routeFolders = (group: string) =>
  readdirSync(path.join(process.cwd(), "src/app", group), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

describe("robots and sitemap", () => {
  it("robots disallows /api, auth, uploads and onboarding, allows only public pages, points at the sitemap", () => {
    const r = robots();
    expect(rule().disallow).toEqual(expect.arrayContaining(["/api/", "/auth/", "/media/", "/i/", "/welcome", "/admin"]));
    expect(rule().allow).toEqual(["/$", "/login", "/graph", "/u/", "/post/"]);
    expect(r.sitemap).toBe("https://connect.empowertours.xyz/sitemap.xml");
  });

  it("disallows every member route folder in src/app/(app)", () => {
    const routes = routeFolders("(app)");
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      expect(blocked(`/${r}`) || blocked(`/${r}/x`), `/${r} must be in MEMBER_PATHS`).toBe(true);
      expect(MEMBER_PATHS.some((p) => p.replace(/\/$/, "") === `/${r}`), `/${r} must be in MEMBER_PATHS`).toBe(true);
    }
    for (const p of ["/admin", "/profile", "/pipeline", "/intros", "/api/auth/session", "/media/a.webp", "/i/abcd2345"]) expect(blocked(p), p).toBe(true);
  });

  it("allows every public route folder in src/app/(open) and keeps it out of MEMBER_PATHS", () => {
    const routes = routeFolders("(open)");
    expect(routes.sort()).toEqual(PUBLIC_PREFIXES.map((p) => p.replace(/\//g, "")).sort());
    for (const r of routes) {
      expect(blocked(`/${r}/x`), `/${r} must be crawlable`).toBe(false);
      expect(MEMBER_PATHS.some((p) => p.replace(/\/$/, "") === `/${r}`), `/${r} must not be in MEMBER_PATHS`).toBe(false);
    }
    for (const p of ["/u/ana", "/post/1", "/u/ana/opengraph-image"]) expect(blocked(p), p).toBe(false);
  });

  it("lets crawlers reach the shared root, the public pages and the preview image", () => {
    for (const p of ["/", "/login", "/graph", "/graph/abc", "/opengraph-image"]) expect(blocked(p), p).toBe(false);
  });

  it("sitemap lists only public pages, profiles and posts on the canonical host", () => {
    expect(APP_URL).toBe("https://connect.empowertours.xyz");
    expect(buildSitemap(APP_URL, [], []).map((e) => e.url)).toEqual([APP_URL, `${APP_URL}/login`, `${APP_URL}/graph`]);
    const at = new Date("2026-10-01T00:00:00Z");
    const urls = buildSitemap(APP_URL, [{ handle: "ana" }], [{ id: "p1", createdAt: at }]).map((e) => e.url);
    expect(urls).toEqual([APP_URL, `${APP_URL}/login`, `${APP_URL}/graph`, `${APP_URL}/u/ana`, `${APP_URL}/post/p1`]);
    for (const url of urls) expect(blocked(new URL(url).pathname), url).toBe(false);
    for (const private_ of ["/admin", "/profile", "/pipeline", "/intros", "/api"]) expect(urls.some((u) => u.includes(private_))).toBe(false);
  });

  it("only finished, non-demo profiles are indexable", () => {
    const done = new Date();
    expect(isIndexableMember({ isDemo: false, onboardedAt: done })).toBe(true);
    expect(isIndexableMember({ isDemo: true, onboardedAt: done })).toBe(false);
    expect(isIndexableMember({ isDemo: false, onboardedAt: null })).toBe(false);
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

describe("public page metadata", () => {
  it("sets the canonical, preview text and type, and noindex when asked", () => {
    const m = publicPageMetadata({ title: "Ana Ruiz (@ana)", description: "Head of BD @ Quetzal Rails", path: "/u/ana", type: "profile", index: true });
    expect(m.alternates?.canonical).toBe("/u/ana");
    expect(m.robots).toBeUndefined();
    expect(m.openGraph).toMatchObject({ type: "profile", url: "/u/ana", title: "Ana Ruiz (@ana)", siteName: "EmpowerTours Connect" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "Ana Ruiz (@ana)" });
    const hidden = publicPageMetadata({ title: "x", description: "", path: "/post/1", type: "article", index: false, publishedTime: new Date(0) });
    expect(hidden.robots).toEqual({ index: false, follow: true });
    expect(hidden.description).toBeTruthy();
    expect(hidden.openGraph).toMatchObject({ type: "article", publishedTime: "1970-01-01T00:00:00.000Z" });
  });

  it("snippet collapses whitespace and cuts on a word", () => {
    expect(snippet("  a\n\n b  ")).toBe("a b");
    const long = "word ".repeat(100);
    const s = snippet(long, 50);
    expect([...s].length).toBeLessThanOrEqual(50);
    expect(s.endsWith("word…")).toBe(true);
    expect(snippet("x".repeat(80), 20)).toBe(`${"x".repeat(19)}…`);
  });
});

describe("public profile fields", () => {
  it("never select private fields for signed-out visitors", () => {
    const keys = Object.keys(publicUserSelect);
    for (const k of ["email", "walletAddress", "passkeyCredentialId", "voice", "xAccountId", "farcasterFid", "mutedTopics", "mutedChannels", "feedAlgorithm"]) {
      expect(keys, k).not.toContain(k);
    }
    expect(keys).toEqual(expect.arrayContaining(["name", "handle", "headline", "bio"]));
  });
});
