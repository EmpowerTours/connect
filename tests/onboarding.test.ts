import { describe, expect, it } from "vitest";
import {
  FOCUS_TAGS,
  ONBOARDING_ERRORS,
  ONBOARDING_STEPS,
  isOnboardingError,
  needsOnboarding,
  onboardingChecklist,
  profileComplete,
  resolveOrgChoice,
  validateBasics,
  validateFocus,
  validateLinks,
} from "@/lib/onboarding";
import { t } from "@/lib/i18n";

describe("onboarding: basics", () => {
  it("trims and collapses whitespace", () => {
    expect(validateBasics({ name: "  Ana   Lucía ", headline: " Head of  BD " })).toEqual({
      ok: true,
      value: { name: "Ana Lucía", headline: "Head of BD" },
    });
  });
  it("requires a name and a headline", () => {
    expect(validateBasics({ name: " ", headline: "BD lead" })).toEqual({ ok: false, error: "name_empty" });
    expect(validateBasics({ name: "Ana", headline: "x" })).toEqual({ ok: false, error: "headline_empty" });
  });
  it("caps lengths by code points", () => {
    expect(validateBasics({ name: "a".repeat(81), headline: "BD lead" })).toEqual({ ok: false, error: "name_long" });
    expect(validateBasics({ name: "Ana", headline: "é".repeat(101) })).toEqual({ ok: false, error: "headline_long" });
    expect(validateBasics({ name: "😀".repeat(80), headline: "BD lead" }).ok).toBe(true);
  });
});

describe("onboarding: region and focus", () => {
  it("accepts a known region and 1-5 known tags (deduped)", () => {
    const r = validateFocus({ region: "latam", tags: ["payments", "stablecoins", "payments"] });
    expect(r).toEqual({ ok: true, value: { region: "latam", tags: ["payments", "stablecoins"] } });
  });
  it("rejects unknown regions and tags, none, or too many", () => {
    expect(validateFocus({ region: "mars", tags: ["payments"] })).toEqual({ ok: false, error: "region" });
    expect(validateFocus({ region: "europe", tags: ["memecoins"] })).toEqual({ ok: false, error: "tag" });
    expect(validateFocus({ region: "europe", tags: [] })).toEqual({ ok: false, error: "tags_empty" });
    expect(validateFocus({ region: "europe", tags: FOCUS_TAGS.slice(0, 6) as unknown as string[] })).toEqual({ ok: false, error: "tags_many" });
  });
});

describe("onboarding: links", () => {
  it("normalizes X handles, LinkedIn paths and websites", () => {
    expect(validateLinks({ x: "@ana_bd", linkedin: "linkedin.com/in/ana-bd", website: "ana.example.com" })).toEqual({
      ok: true,
      value: { linkX: "https://x.com/ana_bd", linkLinkedin: "https://www.linkedin.com/in/ana-bd", linkWebsite: "https://ana.example.com" },
    });
    expect(validateLinks({ x: "", linkedin: "", website: "" })).toEqual({ ok: true, value: { linkX: "", linkLinkedin: "", linkWebsite: "" } });
  });
  it("rejects unsafe or malformed links", () => {
    expect(validateLinks({ x: "not a handle!", linkedin: "", website: "" })).toEqual({ ok: false, error: "x" });
    expect(validateLinks({ x: "", linkedin: "https://evil.example/in/ana", website: "" })).toEqual({ ok: false, error: "linkedin" });
    expect(validateLinks({ x: "", linkedin: "", website: "javascript:alert(1)" })).toEqual({ ok: false, error: "website" });
    expect(validateLinks({ x: "", linkedin: "", website: "http://user:pw@example.com" })).toEqual({ ok: false, error: "website" });
  });
});

describe("onboarding: organization choice", () => {
  const orgs = [{ id: "o1", name: "Circle" }, { id: "o2", name: "Bitso" }];
  it("matches a listed org case-insensitively", () => {
    expect(resolveOrgChoice("  bitso ", orgs)).toEqual({ kind: "existing", orgId: "o2", name: "Bitso" });
  });
  it("treats an unlisted name as a request and blank as none", () => {
    expect(resolveOrgChoice("Quetzal  Pay", orgs)).toEqual({ kind: "new", name: "Quetzal Pay" });
    expect(resolveOrgChoice("   ", orgs)).toEqual({ kind: "none" });
  });
});

describe("onboarding: gating and checklist", () => {
  const base = { name: "Ana", headline: "BD", orgName: "Bitso", region: "latam", focusTags: '["payments"]', onboardedAt: null, isDemo: false };
  it("sends new real members to onboarding, never the demo user", () => {
    expect(needsOnboarding(base)).toBe(true);
    expect(needsOnboarding({ ...base, onboardedAt: new Date() })).toBe(false);
    expect(needsOnboarding({ ...base, isDemo: true })).toBe(false);
  });
  it("knows when a profile is complete", () => {
    expect(profileComplete(base)).toBe(true);
    expect(profileComplete({ ...base, focusTags: "[]" })).toBe(false);
    expect(profileComplete({ ...base, region: "" })).toBe(false);
  });
  it("builds the four-item checklist", () => {
    const c = onboardingChecklist({ profileComplete: true, claimStatus: "pending", opportunities: 0, connections: 0 });
    expect(c.items.map((i) => i.key)).toEqual(["profile", "claim", "ask", "connect"]);
    expect(c.done).toBe(1);
    expect(c.items[1]).toMatchObject({ done: false, pending: true });
    expect(c.complete).toBe(false);
    expect(onboardingChecklist({ profileComplete: true, claimStatus: "approved", opportunities: 1, connections: 2 }).complete).toBe(true);
  });
  it("has a translated message for every whitelisted error", () => {
    for (const e of ONBOARDING_ERRORS) {
      expect(t("en", `onb.err.${e}`)).not.toBe(`onb.err.${e}`);
      expect(t("es", `onb.err.${e}`)).not.toBe(`onb.err.${e}`);
    }
    expect(isOnboardingError("photo_type")).toBe(true);
    expect(isOnboardingError("<script>")).toBe(false);
    expect(isOnboardingError(undefined)).toBe(false);
  });
});

describe("onboarding: steps", () => {
  it("is three steps, each with translated copy", () => {
    expect(ONBOARDING_STEPS).toEqual(["you", "focus", "follow"]);
    for (const step of ONBOARDING_STEPS) for (const part of ["eyebrow", "title", "body"] as const) {
      const key = `onb.${step}.${part}` as const;
      expect(t("en", key)).not.toBe(key);
      expect(t("es", key)).not.toBe(key);
    }
  });
});
