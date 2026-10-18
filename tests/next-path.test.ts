import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { loginPath, safeNextPath } from "@/lib/links";
import { PATHNAME_HEADER } from "@/lib/request-id";
import { middleware } from "@/middleware";

describe("safeNextPath (return to a page after sign-in)", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeNextPath("/u/ana")).toBe("/u/ana");
    expect(safeNextPath("/opportunities/abc?topic=stablecoins#top")).toBe("/opportunities/abc?topic=stablecoins#top");
    expect(safeNextPath("/post/1/../2")).toBe("/post/2");
  });

  it("refuses anything that could leave the origin", () => {
    for (const bad of [
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example/x",
      "/\tevil",
      "/\nevil",
      " /u/ana",
      "",
      `/${"a".repeat(600)}`,
    ]) {
      expect(safeNextPath(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(["/u/ana"])).toBeNull();
  });

  it("never loops back into sign-in, onboarding, auth or APIs", () => {
    for (const p of ["/", "/login", "/login?next=/x", "/login/x", "/welcome", "/welcome?step=org", "/api/auth/session", "/api", "/auth/verify", "/u/../login"]) {
      expect(safeNextPath(p), p).toBeNull();
    }
    expect(safeNextPath("/loginx")).toBe("/loginx");
  });

  it("loginPath encodes the target or falls back to plain /login", () => {
    expect(loginPath("/u/ana?x=1")).toBe("/login?next=%2Fu%2Fana%3Fx%3D1");
    expect(loginPath("//evil.example")).toBe("/login");
    expect(loginPath(null)).toBe("/login");
  });
});

describe("middleware path header", () => {
  it("stamps the requested path and overwrites a client-sent copy", () => {
    const req = new NextRequest("https://connect.empowertours.xyz/u/ana?tab=posts", { headers: { [PATHNAME_HEADER]: "//evil.example" } });
    const res = middleware(req);
    // NextResponse.next({ request: { headers } }) forwards overridden request headers as x-middleware-request-*.
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe("/u/ana?tab=posts");
  });
});
