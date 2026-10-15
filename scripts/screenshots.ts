/**
 * Captures UI screenshots against a running local server.
 *   BASE_URL=http://localhost:3000 OUT_DIR=.. npm run screenshots
 * Needs a Chrome/Chromium binary (CHROME_PATH, default /usr/bin/google-chrome).
 * The server must allow dev login (next dev, or ALLOW_DEV_LOGIN=1 next start).
 */
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve(process.cwd(), "..");
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: /demo user|usuario demo/i }).click();
  await page.waitForURL(/\/pipeline/);
  // Make sure the demo user starts in English (locale is stored on the user).
  const en = page.getByRole("button", { name: "EN", exact: true });
  if (await en.count()) {
    await en.click();
    await page.getByRole("button", { name: "ES", exact: true }).waitFor();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
  const page = await desktop.newPage();
  await login(page);

  await page.goto(`${BASE}/pipeline`);
  await page.screenshot({ path: path.join(OUT, "bdnet-pipeline.png"), fullPage: true });

  await page.goto(`${BASE}/directory`);
  await page.screenshot({ path: path.join(OUT, "bdnet-directory.png") });

  await page.goto(`${BASE}/orgs/bitso`);
  await page.getByRole("button", { name: /Generate fit|Generar encaje/ }).click();
  await page.getByText(/Draft outreach|Borrador de contacto/).first().waitFor();
  await page.getByRole("button", { name: /Generate fit|Generar encaje/ }).waitFor(); // pending state cleared
  await page.screenshot({ path: path.join(OUT, "bdnet-org-ai-draft.png"), fullPage: true });

  await page.goto(`${BASE}/feed?tab=signals&scope=all`);
  await page.screenshot({ path: path.join(OUT, "bdnet-feed-signals.png") });
  await page.goto(`${BASE}/feed?tab=posts&scope=all`);
  await page.screenshot({ path: path.join(OUT, "bdnet-feed-posts.png") });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const m = await mobile.newPage();
  await login(m);
  await m.goto(`${BASE}/pipeline`);
  await m.screenshot({ path: path.join(OUT, "bdnet-mobile-pipeline.png") });
  await m.goto(`${BASE}/feed?tab=signals&scope=all`);
  await m.screenshot({ path: path.join(OUT, "bdnet-mobile-feed.png") });

  // Spanish UI check, then switch back to English.
  await m.goto(`${BASE}/orgs/mercado-pago`);
  // Headless Chrome with isMobile sometimes never reports elements as "stable",
  // so the mobile section clicks via the DOM.
  const tap = (name: string | RegExp) =>
    m.getByRole("button", { name, exact: typeof name === "string" }).evaluate((el) => (el as HTMLButtonElement).click());
  await tap("ES");
  await m.getByText("Datos públicos").waitFor();
  await tap(/Generar encaje/);
  await m.getByText(/Borrador de contacto/).first().waitFor();
  await m.getByText(/Scout con IA/).evaluate((el) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -70); });
  await m.screenshot({ path: path.join(OUT, "bdnet-mobile-org-es.png") });
  await tap("EN");
  await m.getByText("Public facts").waitFor();

  await browser.close();
  console.log(`Screenshots written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
