/**
 * Captures crisp UI screenshots against a running local server.
 *   BASE_URL=http://localhost:3107 OUT_DIR=.. npm run screenshots
 * Desktop: 1440x900 @2x. Mobile: 390x844 @3x. PNG, viewport-sized, never downscaled.
 * Needs a Chrome/Chromium binary (CHROME_PATH, default /usr/bin/google-chrome).
 * The server must allow dev login (next dev, or ALLOW_DEV_LOGIN=1 next start).
 */
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve(process.cwd(), "..");
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const file = (name: string) => path.join(OUT, `corridor-${name}.png`);

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: /demo/i }).first().evaluate((el) => (el as HTMLElement).click());
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  // The locale is stored on the user; make sure we start in English.
  const toggle = page.locator("button[aria-label='Switch language']").first();
  if ((await toggle.textContent())?.trim() === "EN") {
    await toggle.evaluate((el) => (el as HTMLElement).click());
    await page.waitForFunction(() => document.documentElement.lang === "en" || !!document.querySelector("button[aria-label='Switch language']")?.textContent?.includes("ES"));
  }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function shot(page: Page, url: string, name: string) {
  await page.goto(`${BASE}${url}`);
  await settle(page);
  await page.screenshot({ path: file(name), type: "png" });
  console.log("wrote", file(name));
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const d = await desktop.newPage();
  await login(d);
  await shot(d, "/", "home-desktop");
  await shot(d, "/u/tomas", "profile-desktop");
  await shot(d, "/orgs/bitso", "org-desktop");
  await shot(d, "/channels", "channels-desktop");
  await shot(d, "/pipeline", "pipeline-desktop");
  await shot(d, "/intros", "intros-desktop");

  // Warm intro: pick a mutual connection, give a reason, let the scout draft the ask.
  await d.goto(`${BASE}/u/tomas?intro=1`);
  await d.locator("textarea[name=reason]").fill("Exploring a USDC settlement pilot for remittance corridors into Mexico");
  await d.locator("[role=dialog] form button").first().click();
  await d.waitForURL((u) => { const v = u.searchParams.get("intro"); return !!v && v !== "1"; });
  await d.locator("textarea[name=message]").waitFor();
  await settle(d);
  await d.screenshot({ path: file("intro-modal-desktop"), type: "png" });
  console.log("wrote", file("intro-modal-desktop"));

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const m = await mobile.newPage();
  await login(m);
  await shot(m, "/", "feed-mobile");
  await shot(m, "/u/valeria", "profile-mobile");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
