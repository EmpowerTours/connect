import { describe, expect, it } from "vitest";
import { CHANNELS } from "../prisma/seed-base";
import { SEED_ORGS } from "../prisma/seed-data";
import { CURATED_PACKS, PACKS_PRESELECTED, getCuratedPack, pickPackIds, rankPacks } from "@/lib/curated-packs";
import { FOCUS_TAGS } from "@/lib/onboarding";
import { slugify } from "@/lib/slug";

describe("starter packs (curated follow sets)", () => {
  it("only reference seeded organizations, channels and known focus tags", () => {
    const orgs = new Set(SEED_ORGS.map((o) => slugify(o.name)));
    const channels = new Set(CHANNELS.map((c) => c.slug));
    for (const p of CURATED_PACKS) {
      for (const o of p.orgs) expect(orgs.has(o), `${p.id}: org ${o}`).toBe(true);
      for (const c of p.channels) expect(channels.has(c), `${p.id}: channel ${c}`).toBe(true);
      for (const f of p.focus) expect((FOCUS_TAGS as readonly string[]).includes(f), `${p.id}: focus ${f}`).toBe(true);
      expect(p.label.en && p.label.es && p.blurb.en && p.blurb.es).toBeTruthy();
      expect(p.orgs.length + p.channels.length).toBeGreaterThan(0);
    }
  });

  it("have unique ids, and every focus tag is covered by some pack", () => {
    expect(new Set(CURATED_PACKS.map((p) => p.id)).size).toBe(CURATED_PACKS.length);
    const covered = new Set(CURATED_PACKS.flatMap((p) => p.focus));
    for (const f of FOCUS_TAGS) expect(covered.has(f), f).toBe(true);
    expect(getCuratedPack("latam_payments")?.channels).toContain("latam-payments");
    expect(getCuratedPack("nope")).toBeUndefined();
  });

  it("ranks packs by focus overlap and preselects the best matches", () => {
    const r = rankPacks(["payments", "remittances", "wallets"]);
    expect(r[0].pack.id).toBe("latam_payments");
    expect(r[0].score).toBe(3);
    expect(r.filter((x) => x.preselected)).toHaveLength(PACKS_PRESELECTED);
    expect(r.map((x) => x.pack.id).sort()).toEqual(CURATED_PACKS.map((p) => p.id).sort());
    // No focus overlap: keep the list order and preselect nothing.
    const none = rankPacks([]);
    expect(none.map((x) => x.pack.id)).toEqual(CURATED_PACKS.map((p) => p.id));
    expect(none.some((x) => x.preselected)).toBe(false);
  });

  it("accepts only known pack ids from a form, deduped", () => {
    expect(pickPackIds(["monad_builders", " stablecoin_rails ", "monad_builders", "<script>", ""])).toEqual(["stablecoin_rails", "monad_builders"]);
    expect(pickPackIds([])).toEqual([]);
  });
});
