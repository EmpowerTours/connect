import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { APP_URL } from "@/lib/brand";

describe("robots and sitemap", () => {
  it("robots disallows /api and member pages, allows only public pages, points at the sitemap", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/admin", "/"]));
    expect(rule.allow).toEqual(["/login", "/graph"]);
    expect(r.sitemap).toBe("https://connect.empowertours.xyz/sitemap.xml");
  });

  it("sitemap lists only public pages on the canonical host", () => {
    const urls = sitemap().map((e) => e.url);
    expect(APP_URL).toBe("https://connect.empowertours.xyz");
    expect(urls).toEqual([`${APP_URL}/login`, `${APP_URL}/graph`]);
    for (const private_ of ["/admin", "/profile", "/pipeline", "/intros", "/api"]) expect(urls.some((u) => u.includes(private_))).toBe(false);
  });
});
