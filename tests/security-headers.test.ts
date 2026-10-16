import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contentSecurityPolicy, makeNonce, staticSecurityHeaders } from "@/lib/security-headers";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("content security policy", () => {
  it("allows only nonced scripts and same-origin connections in production", () => {
    const csp = contentSecurityPolicy("abc123");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("relaxes only what the dev server needs", () => {
    const csp = contentSecurityPolicy("n", { dev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("makes fresh 128-bit nonces", () => {
    const a = makeNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(makeNonce()).not.toBe(a);
  });

  it("middleware applies the CSP to pages", () => {
    const src = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
    expect(src).toMatch(/response\.headers\.set\("Content-Security-Policy", csp\)/);
  });
});

describe("static headers", () => {
  it("sets the baseline everywhere and HSTS in production", () => {
    const keys = (h: { key: string }[]) => h.map((x) => x.key);
    expect(keys(staticSecurityHeaders())).toEqual(expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"]));
    expect(keys(staticSecurityHeaders())).not.toContain("Strict-Transport-Security");
    expect(keys(staticSecurityHeaders({ production: true }))).toContain("Strict-Transport-Security");
    const pp = staticSecurityHeaders().find((h) => h.key === "Permissions-Policy")!.value;
    expect(pp).toContain("publickey-credentials-get=(self)");
    expect(pp).toContain("publickey-credentials-create=(self)");
  });
});
