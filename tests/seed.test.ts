import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHANNELS, demoSeedAllowed, seedBase, type BaseSeedDb } from "../prisma/seed-base";
import { SEED_ORGS } from "../prisma/seed-data";

/** Records every model.method a seed touches, refusing anything but upserts on the allowed models. */
function recordingDb() {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const db = new Proxy({} as Record<string, unknown>, {
    get(_t, model: string) {
      return new Proxy({}, {
        get(_t2, method: string) {
          return async (args: unknown) => {
            calls.push({ model, method, args });
            return {};
          };
        },
      });
    },
  });
  return { db: db as unknown as BaseSeedDb, calls };
}

describe("production seed", () => {
  it("creates the 53 real orgs, feeds and channels, and no people or content", async () => {
    const { db, calls } = recordingDb();
    const n = await seedBase(db);
    expect(n.orgs).toBe(53);
    expect(SEED_ORGS).toHaveLength(53);
    expect(new Set(calls.map((c) => c.model))).toEqual(new Set(["organization", "rssFeed", "channel"]));
    expect(calls.every((c) => c.method === "upsert")).toBe(true);
    const json = JSON.stringify(calls);
    expect(json).not.toMatch(/isDemo|"email"|"handle"|demo\.corridor|Quetzal|Meridiano/);
    expect(calls.filter((c) => c.model === "channel")).toHaveLength(CHANNELS.length);
  });

  it("the default seed script never imports the demo network", () => {
    const src = readFileSync(new URL("../prisma/seed.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/seed-social|seed-demo|isDemo|user\./);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    for (const k of ["db:seed", "setup", "db:reset"]) expect(pkg.scripts[k]).toContain("prisma/seed.ts");
    expect(pkg.scripts["seed:demo"]).toBe("tsx prisma/seed-demo.ts");
  });

  it("the demo seed refuses to run in production", () => {
    expect(demoSeedAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(demoSeedAllowed({ NODE_ENV: "development" })).toBe(true);
    const src = readFileSync(new URL("../prisma/seed-demo.ts", import.meta.url), "utf8");
    expect(src).toMatch(/if \(!demoSeedAllowed\(\)\)/);
  });
});
