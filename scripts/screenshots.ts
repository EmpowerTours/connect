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
const PREFIX = process.env.PREFIX ?? "corridor-v3";
const file = (name: string) => path.join(OUT, `${PREFIX}-${name}.png`);

// Headless Chrome with isMobile sometimes never reports elements as "stable", so click via the DOM.
const domClick = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => (el as HTMLElement).click());

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: /demo/i }).first().evaluate((el) => (el as HTMLElement).click());
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  // The locale is stored on the user; make sure we start in English.
  if ((await page.evaluate(() => document.documentElement.lang)) !== "en") {
    await page.goto(`${BASE}/more`);
    await domClick(page, "button[aria-label='Switch language']");
    await page.waitForFunction(() => document.documentElement.lang === "en");
  }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700); // let entrance animations finish
}

async function shot(page: Page, url: string, name: string) {
  await page.goto(`${BASE}${url}`);
  await settle(page);
  await page.screenshot({ path: file(name), type: "png" });
  console.log("wrote", file(name));
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light" });
  const m = await mobile.newPage();
  await login(m);
  await shot(m, "/", "today-mobile");
  await shot(m, "/opportunities", "opportunities-mobile");
  await shot(m, "/circle", "circle-mobile");
  await domClick(m, "button[aria-label^='Tomás']");
  await m.locator("[role=dialog]").waitFor();
  await settle(m);
  await m.screenshot({ path: file("circle-sheet-mobile"), type: "png" });
  console.log("wrote", file("circle-sheet-mobile"));

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  const d = await desktop.newPage();
  await login(d);
  await shot(d, "/", "today-desktop");
  await shot(d, "/opportunities", "opportunities-desktop");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
