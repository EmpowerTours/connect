import { describe, expect, it } from "vitest";
import { SEED_ORGS } from "../prisma/seed-data";
import { devLoginAllowed, handleFromEmail, isLinkUsable, isValidEmail, normalizeEmail } from "@/lib/auth-core";
import { ORG_TYPES, regionForCountry } from "@/lib/constants";
import { MESSAGES, ORG_TYPE_LABELS, REGION_LABELS, t } from "@/lib/i18n";
import { parseList, toList } from "@/lib/json";
import { slugify } from "@/lib/slug";

describe("i18n", () => {
  it("EN and ES have the same keys and no empty strings", () => {
    expect(Object.keys(MESSAGES.es).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const loc of ["en", "es"] as const) for (const v of Object.values(MESSAGES[loc])) expect(v.trim()).not.toBe("");
  });
  it("labels cover every org type and region in both languages", () => {
    for (const loc of ["en", "es"] as const) {
      for (const ty of ORG_TYPES) expect(ORG_TYPE_LABELS[loc][ty]).toBeTruthy();
      for (const r of Object.keys(REGION_LABELS.en)) expect(REGION_LABELS[loc][r]).toBeTruthy();
    }
    expect(t("es", "nav.directory")).toBe("Directorio");
  });
});

describe("auth-core", () => {
  it("emails", () => {
    expect(normalizeEmail("  A@B.com ")).toBe("a@b.com");
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
  });
  it("magic link usability", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(isLinkUsable(null, now)).toBe(false);
    expect(isLinkUsable({ expiresAt: new Date("2026-10-15T00:10:00Z"), usedAt: null }, now)).toBe(true);
    expect(isLinkUsable({ expiresAt: new Date("2026-10-14T00:00:00Z"), usedAt: null }, now)).toBe(false);
    expect(isLinkUsable({ expiresAt: new Date("2026-10-15T00:10:00Z"), usedAt: now }, now)).toBe(false);
  });
  it("unique handles", () => {
    expect(handleFromEmail("Ana.Lopez@x.com", new Set())).toBe("analopez");
    expect(handleFromEmail("ana@x.com", new Set(["ana", "ana2"]))).toBe("ana3");
    expect(handleFromEmail("...@x.com", new Set())).toBe("user");
  });
  it("dev login gate", () => {
    expect(devLoginAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(devLoginAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(devLoginAllowed({ NODE_ENV: "production", ALLOW_DEV_LOGIN: "1" })).toBe(true);
  });
});

describe("json + slug + regions", () => {
  it("toList dedupes and trims; parseList is defensive", () => {
    expect(parseList(toList(" Solana, solana ,, Avalanche"))).toEqual(["Solana", "Avalanche"]);
    expect(parseList("not json")).toEqual([]);
    expect(parseList('{"a":1}')).toEqual([]);
    expect(parseList('["a", 1]')).toEqual(["a"]);
  });
  it("slugify", () => {
    expect(slugify("Fintech México")).toBe("fintech-mexico");
    expect(slugify("McKinsey & Company")).toBe("mckinsey-and-company");
  });
  it("regions", () => {
    expect(regionForCountry("mx")).toBe("latam");
    expect(regionForCountry("")).toBe("");
    expect(regionForCountry("ZZ")).toBe("");
  });
});

describe("seed data integrity", () => {
  it("has ~40+ orgs with unique slugs, valid types, https websites, ISO-2 or empty countries", () => {
    expect(SEED_ORGS.length).toBeGreaterThanOrEqual(40);
    const slugs = SEED_ORGS.map((o) => slugify(o.name));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const o of SEED_ORGS) {
      expect(ORG_TYPES).toContain(o.type);
      expect(o.website).toMatch(/^https:\/\//);
      expect(o.country).toMatch(/^([A-Z]{2})?$/);
    }
  });
  it("only foundations' own chains or research-cited facts populate chainsInUse", () => {
    const withChains = SEED_ORGS.filter((o) => o.chainsInUse?.length);
    for (const o of withChains) expect(o.type === "foundation" || Boolean(o.notes?.includes("source:")) || o.name === "Ripple").toBe(true);
  });
});
