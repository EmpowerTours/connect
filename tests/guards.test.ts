import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Every "use server" module under src/app. */
function serverActionFiles(dir = path.resolve(__dirname, "../src/app")): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return serverActionFiles(p);
    return /\.tsx?$/.test(f) && /^\s*["']use server["']/.test(readFileSync(p, "utf8")) ? [p] : [];
  });
}

const PUBLIC = new Set(["devLoginAction", "logoutAction", "setLocaleAction"]);
const SESSION = /requireUser\(\)|requireAdmin\(\)|ownedDeal\(|ownedOpportunity\(|transitionIntro\(|moveDealAction\(/;

describe("server action guards", () => {
  const files = serverActionFiles();

  it("finds the server action modules", () => {
    expect(files.map((f) => path.basename(f))).toEqual(expect.arrayContaining(["actions.ts", "claim-actions.ts"]));
  });

  for (const file of files) {
    it(`${path.basename(file)}: every exported action checks the session (admin actions: the admin allowlist)`, () => {
      const src = readFileSync(file, "utf8");
      for (const part of src.split(/\nexport async function /).slice(1)) {
        const name = part.slice(0, part.indexOf("("));
        const body = part.split(/\n}\n/)[0];
        if (PUBLIC.has(name)) continue;
        expect(SESSION.test(body), `${name} must check the session`).toBe(true);
        if (/^admin/.test(name)) expect(body, `${name} must call requireAdmin()`).toMatch(/requireAdmin\(\)/);
      }
    });
  }
});
