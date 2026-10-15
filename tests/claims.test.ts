import { describe, expect, it } from "vitest";
import { adminWallets, isAdmin } from "@/lib/admin";
import { applyClaimAction, canClaim, validateClaimInput, validateOrgRequest } from "@/lib/claims";
import { linkLabel, normalizeLinkedIn, normalizeWebUrl, normalizeXHandle } from "@/lib/links";

const W = "0x" + "ab".repeat(20);
const verified = { walletVerified: true, walletAddress: W };

describe("admin allowlist", () => {
  const env = { ADMIN_WALLETS: ` ${W.toUpperCase().replace("0X", "0x")}, not-a-wallet,0x${"cd".repeat(20)} ` };
  it("parses ADMIN_WALLETS, lowercases and drops junk", () => {
    expect(adminWallets(env)).toEqual(new Set([W, "0x" + "cd".repeat(20)]));
    expect(adminWallets({})).toEqual(new Set());
  });
  it("needs a Mera session for an allowlisted, verified wallet", () => {
    expect(isAdmin(verified, "mera", env)).toBe(true);
    expect(isAdmin(verified, "demo", env)).toBe(false);
    expect(isAdmin({ walletVerified: false, walletAddress: W }, "mera", env)).toBe(false);
    expect(isAdmin({ walletVerified: true, walletAddress: "0x" + "ef".repeat(20) }, "mera", env)).toBe(false);
    expect(isAdmin(verified, "mera", {})).toBe(false);
    expect(isAdmin(null, "mera", env)).toBe(false);
  });
});

describe("org claims", () => {
  it("only passkey-verified users can claim, once at a time", () => {
    expect(canClaim({ walletVerified: false, walletAddress: null }, null)).toEqual({ ok: false, error: "wallet_required" });
    expect(canClaim(verified, null)).toEqual({ ok: true });
    expect(canClaim(verified, { status: "pending" })).toEqual({ ok: false, error: "already_pending" });
    expect(canClaim(verified, { status: "approved" })).toEqual({ ok: false, error: "already_member" });
    expect(canClaim(verified, { status: "rejected" })).toEqual({ ok: true });
    expect(canClaim(verified, { status: "withdrawn" })).toEqual({ ok: true });
  });

  it("stays pending until an admin approves or rejects", () => {
    const claim = { status: "pending", userId: "u1" };
    const admin = { userId: "a", isAdmin: true };
    const member = { userId: "u1", isAdmin: false };
    expect(applyClaimAction(claim, "approve", member)).toEqual({ ok: false, error: "admin only" });
    expect(applyClaimAction(claim, "approve", admin)).toEqual({ ok: true, status: "approved" });
    expect(applyClaimAction(claim, "reject", admin)).toEqual({ ok: true, status: "rejected" });
    expect(applyClaimAction(claim, "withdraw", member)).toEqual({ ok: true, status: "withdrawn" });
    expect(applyClaimAction(claim, "withdraw", { userId: "other", isAdmin: false }).ok).toBe(false);
    expect(applyClaimAction({ status: "approved", userId: "u1" }, "approve", admin).ok).toBe(false);
    expect(applyClaimAction({ status: "approved", userId: "u1" }, "revoke", admin)).toEqual({ ok: true, status: "revoked" });
    expect(applyClaimAction({ status: "approved", userId: "u1" }, "revoke", member).ok).toBe(false);
    expect(applyClaimAction({ status: "rejected", userId: "u1" }, "approve", admin).ok).toBe(false);
  });

  it("validates claim input", () => {
    expect(validateClaimInput({ title: "  Head of   BD ", evidenceUrl: "linkedin.com/in/ana", note: "" })).toEqual({
      ok: true,
      value: { title: "Head of BD", evidenceUrl: "https://linkedin.com/in/ana", note: "" },
    });
    expect(validateClaimInput({ title: "x".repeat(101), evidenceUrl: "", note: "" })).toEqual({ ok: false, error: "title_long" });
    expect(validateClaimInput({ title: "", evidenceUrl: "javascript:alert(1)", note: "" })).toEqual({ ok: false, error: "evidence_url" });
    expect(validateClaimInput({ title: "", evidenceUrl: "", note: "n".repeat(501) })).toEqual({ ok: false, error: "note_long" });
  });

  it("validates new-org requests and refuses duplicates", () => {
    const existing = [{ slug: "bitso", name: "Bitso" }];
    expect(validateOrgRequest({ name: "Bitso", website: "", type: "" }, existing)).toEqual({ ok: false, error: "exists" });
    expect(validateOrgRequest({ name: "bitso ", website: "", type: "exchange" }, existing)).toEqual({ ok: false, error: "exists" });
    expect(validateOrgRequest({ name: "", website: "", type: "" }, existing)).toEqual({ ok: false, error: "name_empty" });
    expect(validateOrgRequest({ name: "Acme Pay", website: "acme.example", type: "bank" }, existing)).toEqual({
      ok: true,
      value: { name: "Acme Pay", website: "https://acme.example", type: "bank", slug: "acme-pay" },
    });
    expect(validateOrgRequest({ name: "Acme Pay", website: "", type: "spaceship" }, existing)).toEqual({ ok: false, error: "type" });
    expect(validateOrgRequest({ name: "Acme Pay", website: "ftp://x.y", type: "" }, existing)).toEqual({ ok: false, error: "website" });
  });
});

describe("links", () => {
  it("normalizes websites to https and refuses unsafe schemes", () => {
    expect(normalizeWebUrl("")).toEqual({ ok: true, value: "" });
    expect(normalizeWebUrl("acme.com")).toEqual({ ok: true, value: "https://acme.com" });
    expect(normalizeWebUrl("http://acme.com/about/")).toEqual({ ok: true, value: "https://acme.com/about" });
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "https://user:pw@acme.com", "not a url", "localhost"]) expect(normalizeWebUrl(bad).ok).toBe(false);
  });
  it("normalizes X handles", () => {
    for (const ok of ["@ana_r", "ana_r", "x.com/ana_r", "https://twitter.com/ana_r"]) expect(normalizeXHandle(ok)).toEqual({ ok: true, value: "https://x.com/ana_r" });
    expect(normalizeXHandle("https://evil.com/ana").ok).toBe(false);
    expect(normalizeXHandle("way_too_long_handle_123").ok).toBe(false);
  });
  it("accepts only LinkedIn profile or company URLs", () => {
    expect(normalizeLinkedIn("linkedin.com/in/ana-ruiz")).toEqual({ ok: true, value: "https://www.linkedin.com/in/ana-ruiz" });
    expect(normalizeLinkedIn("https://www.linkedin.com/company/acme/")).toEqual({ ok: true, value: "https://www.linkedin.com/company/acme" });
    expect(normalizeLinkedIn("https://linkedin.com/feed").ok).toBe(false);
    expect(normalizeLinkedIn("https://notlinkedin.com/in/ana").ok).toBe(false);
    expect(linkLabel("https://www.linkedin.com/in/ana")).toBe("linkedin.com/in/ana");
  });
});
