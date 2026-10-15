/**
 * Captures crisp UI screenshots against a running local server.
 *   BASE_URL=http://localhost:3107 OUT_DIR=.. npm run screenshots
 * Desktop: 1440x900 @2x. Mobile: 390x844 @3x. PNG, viewport-sized, never downscaled.
 * Needs a Chrome/Chromium binary (CHROME_PATH, default /usr/bin/google-chrome).
 * The server must allow dev login (next dev, or ALLOW_DEV_LOGIN=1 next start).
 * For the wallet shot the server also needs AUTH_SESSION_SECRET (any 32+ chars).
 * ONLY=auth captures just the sign-in and wallet-profile shots.
 */
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { LINK_STATEMENT, sessionTypedData } from "../src/lib/mera/typed-data";

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

/**
 * A headless browser cannot run a real passkey ceremony, so for the wallet
 * shot a throwaway in-memory key stands in for the passkey-derived key. It
 * signs the same off-chain EIP-712 link message the browser would, and the
 * server verifies it through the real /api/auth/link route. No transaction;
 * the key is discarded when the script exits.
 */
async function linkThrowawayWallet(page: Page): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const { nonce, serverTs } = (await (await page.request.get(`${BASE}/api/auth/nonce`)).json()) as { nonce: string; serverTs: number };
  const signature = await account.signTypedData(sessionTypedData({ wallet: account.address, clientTs: serverTs, nonce, statement: LINK_STATEMENT }));
  const res = await page.request.post(`${BASE}/api/auth/link`, {
    data: { wallet: account.address, statement: LINK_STATEMENT, clientTs: serverTs, nonce, signature },
  });
  if (!res.ok()) throw new Error(`link failed: ${res.status()} ${await res.text()}`);
  const me = (await (await page.request.get(`${BASE}/api/auth/session`)).json()) as { user: { handle: string }; method: string };
  console.log("linked", account.address, "to", me.user.handle, "session:", me.method);
  return me.user.handle;
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const mobileOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light" } as const;

  const anon = await (await browser.newContext(mobileOpts)).newPage();
  await shot(anon, "/login", "signin-mobile");

  const mobile = await browser.newContext(mobileOpts);
  const m = await mobile.newPage();
  await login(m);
  const handle = await linkThrowawayWallet(m);
  await shot(m, `/u/${handle}`, "profile-wallet-mobile");
  if (process.env.ONLY === "auth") {
    await browser.close();
    return;
  }
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
