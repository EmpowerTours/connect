/**
 * "Real data" screenshots: a brand-new member on a database seeded only with
 * the base seed (53 public orgs, feeds, channels) plus real ingested news.
 *
 *   (npm run db:start in another terminal; any PostgreSQL database works)
 *   DATABASE_URL=<preview db> npx prisma migrate deploy && npx tsx prisma/seed.ts && npm run ingest
 *   PREVIEW_DB=<preview db> npx tsx scripts/screenshots-real.ts
 *
 * The script starts its own `next dev` (PORT, default 3188) so it can make a
 * throwaway key the admin for this run only. A headless browser cannot run a
 * passkey ceremony, so that in-memory key stands in for the passkey-derived
 * Mera key: it signs the same off-chain EIP-712 Registration message and the
 * server verifies it through the real /api/auth/register route. No
 * transaction is signed or sent, and the key is discarded on exit.
 * Output: OUT_DIR/connect-real-*.png at 390x844 @3x.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { chromium, type Page } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { registrationTypedData } from "../src/lib/mera/typed-data";

const PORT = Number(process.env.PORT ?? 3188);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT_DIR ?? path.resolve(process.cwd(), "..");
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const DB = process.env.PREVIEW_DB ?? "";
if (!DB) throw new Error("set PREVIEW_DB to a migrated, seeded PostgreSQL database (see the comment at the top)");
const UPLOADS = process.env.PREVIEW_UPLOADS ?? path.resolve(process.cwd(), ".data", "preview-uploads");
const file = (name: string) => path.join(OUT, `connect-real-${name}.png`);
const click = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => (el as HTMLElement).click());

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.waitForTimeout(700);
}
async function snap(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: file(name), type: "png" });
  console.log("wrote", file(name));
}
async function submitAndWait(page: Page, sel: string, url: RegExp) {
  await Promise.all([page.waitForURL(url), click(page, sel)]);
}

/** A stand-in portrait (abstract, no real person) with EXIF + GPS tags so the upload exercises stripping. */
async function makePhoto(): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3eeff"/><stop offset="1" stop-color="#c4b5fd"/></linearGradient>
      <linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#4c1d95"/></linearGradient>
    </defs>
    <rect width="900" height="1100" fill="url(#bg)"/>
    <circle cx="720" cy="190" r="170" fill="#ffffff" opacity="0.45"/>
    <circle cx="450" cy="430" r="170" fill="#f5d0c5"/>
    <path d="M280 420 Q290 230 450 230 Q610 230 620 420 Q600 330 450 320 Q300 330 280 420Z" fill="#2e1065"/>
    <path d="M140 1100 Q160 700 450 690 Q740 700 760 1100Z" fill="url(#p)"/>
  </svg>`;
  const p = path.join(tmpdir(), "connect-preview-photo.jpg");
  const jpg = await sharp(Buffer.from(svg))
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Artist: "preview", Copyright: "preview" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 25/1 0/1" } })
    .toBuffer();
  writeFileSync(p, jpg);
  return p;
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());
  const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: {
      ...process.env,
      DATABASE_URL: DB,
      AUTH_SESSION_SECRET: randomBytes(32).toString("hex"),
      ADMIN_WALLETS: account.address,
      UPLOADS_DIR: UPLOADS,
      STORAGE_DRIVER: "local",
    },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true, // own process group, so the whole dev server tree can be stopped
  });
  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {}
  };
  try {
    await waitForServer();
    const photo = await makePhoto();
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light", locale: "en-US" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    await page.goto(`${BASE}/login`);

    // Sign up with the throwaway key (off-chain EIP-712 Registration; no transaction).
    const { nonce, serverTs } = (await (await page.request.get(`${BASE}/api/auth/nonce`)).json()) as { nonce: string; serverTs: number };
    const displayName = "Sofía Marín";
    const passkeyCredentialId = randomBytes(32).toString("base64url");
    const signature = await account.signTypedData(registrationTypedData({ wallet: account.address, displayName, passkeyCredentialId, clientTs: serverTs, nonce }));
    const reg = await page.request.post(`${BASE}/api/auth/register`, { data: { wallet: account.address, displayName, passkeyCredentialId, clientTs: serverTs, nonce, signature } });
    if (!reg.ok()) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
    console.log("registered throwaway wallet", account.address);

    // New members land on onboarding.
    await page.goto(`${BASE}/`);
    await page.waitForURL(/\/welcome/);
    await page.fill("input[name=headline]", "Head of Partnerships, LatAm payments");
    await page.fill("input[name=org]", "Bitso");
    await page.locator("input[name=claim]").evaluate((el) => ((el as HTMLInputElement).checked = true));
    await page.locator("input[name=org]").blur();
    await snap(page, "onboarding-1-you");
    await submitAndWait(page, "form button:not([name]):not([type=button])", /step=focus/);

    await click(page, "input[name=region][value=latam]");
    for (const tag of ["payments", "stablecoins", "remittances"]) await click(page, `input[name=tags][value=${tag}]`);
    await snap(page, "onboarding-2-focus");
    await submitAndWait(page, "form button:not([name]):not([type=button])", /step=follow/);

    // Starter packs come preselected from the focus areas; the Farcaster lookup is optional.
    await snap(page, "onboarding-3-follow");
    await submitAndWait(page, "[data-testid=onb-packs] button:not([name])", /welcome=1/);

    await snap(page, "today");
    await page.evaluate(() => document.getElementById("getting-started")?.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -24));
    await page.waitForTimeout(400);
    await page.screenshot({ path: file("today-checklist"), type: "png" });
    console.log("wrote", file("today-checklist"));

    await page.goto(`${BASE}/opportunities`);
    await snap(page, "opportunities-empty");
    await page.goto(`${BASE}/opportunities?topic=payments`);
    await snap(page, "opportunities-empty-topic");

    // Photo and links moved out of onboarding into Edit profile.
    await page.goto(`${BASE}/profile`);
    await page.setInputFiles("input[name=photo]", photo);
    await page.fill("input[name=x]", "sofia_marin_pay");
    await page.fill("input[name=linkedin]", "linkedin.com/in/sofia-marin-pay");
    await submitAndWait(page, "#photo form button:not([name]):not([type=button])", /saved=1/);

    const me = (await (await page.request.get(`${BASE}/api/auth/session`)).json()) as { user: { handle: string } };
    await page.goto(`${BASE}/u/${me.user.handle}`);
    await snap(page, "profile");

    await page.goto(`${BASE}/admin`);
    await snap(page, "admin-claims");

    await browser.close();
  } finally {
    stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
