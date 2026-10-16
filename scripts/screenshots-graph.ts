/**
 * Screenshots for the programmable feed, the cold-start importers and the
 * signed graph, on a throwaway preview database (a new graph_preview_<timestamp> database
 * per run in the local PostgreSQL from scripts/lib/local-postgres.ts) seeded with the
 * clearly-labelled demo people.
 *
 *   npx tsx scripts/screenshots-graph.ts            # OUT_DIR defaults to the parent folder
 *
 * Nothing leaves this machine:
 *   - a local mock serves the Farcaster hub API and the Monad JSON-RPC
 *     (balanceOf only), so imports are deterministic and offline;
 *   - throwaway in-memory keys stand in for passkey-derived Mera keys (a
 *     headless browser cannot run a passkey ceremony). They sign the same
 *     off-chain EIP-712 Session / GraphUpdate messages the browser would and
 *     the server verifies them through the real routes. No transaction is
 *     signed or sent; the keys are discarded on exit.
 * Output: OUT_DIR/connect-{feed,import,graph}-*.png at 390x844 @3x.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, request, type APIRequestContext, type Page } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { graphTypedData, type GraphMessage } from "../src/lib/graph/typed-data";
import { ensureDatabase, startLocalPostgres } from "./lib/local-postgres";
import { SESSION_STATEMENT, sessionTypedData } from "../src/lib/mera/typed-data";

const PORT = Number(process.env.PORT ?? 3189);
const MOCK_PORT = PORT + 1;
const BASE = `http://localhost:${PORT}`;
const MOCK = `http://localhost:${MOCK_PORT}`;
const OUT = process.env.OUT_DIR ?? path.resolve(process.cwd(), "..");
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
/** A brand-new database per run in the local PostgreSQL, so nothing existing is ever reset. */
const DB_NAME = `graph_preview_${Date.now()}`;
let DB = "";
const file = (name: string) => path.join(OUT, `connect-${name}.png`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- personas (demo people from seed:demo, given throwaway wallets) ---------- */
const keys = { valeria: privateKeyToAccount(generatePrivateKey()), tomas: privateKeyToAccount(generatePrivateKey()), priya: privateKeyToAccount(generatePrivateKey()), mei: privateKeyToAccount(generatePrivateKey()), admin: privateKeyToAccount(generatePrivateKey()) };
const addr = (k: keyof typeof keys) => keys[k].address.toLowerCase();

/* ---------- local mock: Farcaster hub + Monad RPC ---------- */
function startMock() {
  const fids: Record<number, { username: string; display: string; wallet?: string }> = {
    501: { username: "valeria", display: "Valeria Ortiz", wallet: addr("valeria") },
    502: { username: "tomasreyes", display: "Tomás Reyes" },
    503: { username: "priya", display: "Priya Nair" },
  };
  const holders: Record<string, string[]> = {
    "0x4d5533e29cf190131885dc7dbef22e31f4252410": [addr("valeria"), addr("tomas")], // Hunt passport
    "0x13a63a60b0e0104911e845a7e944646045c1558f": [addr("valeria"), addr("mei")], // TURBO cohort
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", MOCK);
    const json = (v: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(v));
    };
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: [{ to: string; data: string }] };
        if (method !== "eth_call") return json({ jsonrpc: "2.0", id, error: { message: "mock: read-only" } });
        const owner = `0x${params[0].data.slice(-40)}`;
        const held = (holders[params[0].to.toLowerCase()] ?? []).includes(owner);
        json({ jsonrpc: "2.0", id, result: `0x${(held ? 1 : 0).toString(16).padStart(64, "0")}` });
      });
      return;
    }
    const fid = Number(url.searchParams.get("fid"));
    switch (url.pathname) {
      case "/v1/userNameProofByName": {
        const hit = Object.entries(fids).find(([, v]) => v.username === url.searchParams.get("name"));
        return hit ? json({ fid: Number(hit[0]), owner: "0x00000000000000000000000000000000000000aa" }) : ((res.statusCode = 404), res.end());
      }
      case "/v1/userDataByFid":
        return json({ messages: fids[fid] ? [{ data: { userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: fids[fid].username } } }, { data: { userDataBody: { type: "USER_DATA_TYPE_DISPLAY", value: fids[fid].display } } }] : [] });
      case "/v1/verificationsByFid":
        return json({ messages: fids[fid]?.wallet ? [{ data: { verificationAddAddressBody: { address: fids[fid].wallet, protocol: "PROTOCOL_ETHEREUM" } } }] : [] });
      case "/v1/linksByFid":
        return json({ messages: (fid === 501 ? [502, 503, 7101, 7102, 7103, 7104, 7105, 7106, 7107] : []).map((t) => ({ data: { linkBody: { type: "follow", targetFid: t } } })), nextPageToken: "" });
      case "/v1/onChainIdRegistryEventByAddress":
        return res.end("");
      default:
        res.statusCode = 404;
        res.end();
    }
  });
  server.listen(MOCK_PORT);
  return server;
}

/* ---------- helpers ---------- */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Lazy images below the fold never load; only wait (briefly) for the ones the browser started.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), undefined, { timeout: 8000 }).catch(() => {});
  // Keep the active feed chip in view (the chip row scrolls sideways on phones).
  await page.evaluate(() => document.querySelector("[data-testid=feed-picker] [aria-checked=true]")?.scrollIntoView({ inline: "center", block: "nearest" }));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}
async function snap(page: Page, name: string, opts: { scrollTo?: string; offset?: number } = {}) {
  await settle(page);
  if (opts.scrollTo) {
    await page.evaluate(([sel, off]) => {
      document.querySelector(sel as string)?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -(off as number));
    }, [opts.scrollTo, opts.offset ?? 70] as const);
    await page.waitForTimeout(350);
  }
  await page.screenshot({ path: file(name), type: "png" });
  console.log("wrote", file(name));
}
const click = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => (el as HTMLElement).click());

async function login(api: APIRequestContext, acct: PrivateKeyAccount) {
  const { nonce, serverTs } = (await (await api.get(`${BASE}/api/auth/nonce`)).json()) as { nonce: string; serverTs: number };
  const signature = await acct.signTypedData(sessionTypedData({ wallet: acct.address, clientTs: serverTs, nonce }));
  const res = await api.post(`${BASE}/api/auth/session`, { data: { wallet: acct.address, statement: SESSION_STATEMENT, clientTs: serverTs, nonce, signature } });
  if (!res.ok()) throw new Error(`login failed ${res.status()} ${await res.text()}`);
}

/**
 * GET JSON, retrying a couple of times: `next dev` occasionally answers with its HTML error
 * page while it recompiles. Reported, never swallowed: the third failure throws.
 */
async function getJson(api: APIRequestContext, url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await api.get(url);
    const type = res.headers()["content-type"] ?? "";
    if (res.ok() && type.includes("application/json")) return res.json();
    console.warn(`GET ${url} -> ${res.status()} ${type} (attempt ${attempt})`);
    if (attempt === 3) throw new Error(`GET ${url} failed: ${res.status()}`);
    await sleep(1500);
  }
}

/** Exactly what signGraphUpdates() does in the browser, with the throwaway key. */
async function signGraph(api: APIRequestContext, acct: PrivateKeyAccount): Promise<number> {
  const pending = (await getJson(api, `${BASE}/api/graph/pending`)) as { messages: GraphMessage[] };
  if (!pending.messages?.length) return 0;
  const items = [];
  for (const m of pending.messages) items.push({ message: m, signature: await acct.signTypedData(graphTypedData(m)) });
  let res = await api.post(`${BASE}/api/graph/sign`, { data: { items } });
  // Same dev-server hiccup as getJson: an HTML 500 means the route never ran, so one retry is safe
  // (and a duplicate would be refused anyway: each (author, seq) is unique).
  if (res.status() === 500 && (res.headers()["content-type"] ?? "").includes("text/html")) {
    console.warn("POST /api/graph/sign -> dev server error page, retrying once");
    await sleep(1500);
    res = await api.post(`${BASE}/api/graph/sign`, { data: { items } });
  }
  if (!res.ok()) throw new Error(`sign failed ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return items.length;
}

async function waitForServer() {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error("server did not start");
}

/* ---------- preview database ---------- */
async function createPreviewDb() {
  const { pg } = await startLocalPostgres();
  DB = await ensureDatabase(pg, DB_NAME);
  const env = { ...process.env, DATABASE_URL: DB, NODE_ENV: "development" as const };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "ignore" });
  execFileSync("npx", ["tsx", "prisma/seed-demo.ts"], { env, stdio: "ignore" });
}

async function seedScenario(db: PrismaClient) {
  const u = async (handle: string) => db.user.findUniqueOrThrow({ where: { handle } });
  const [valeria, tomas, priya, mei, lucas, daniel] = await Promise.all(["valeria", "tomas", "priya", "mei", "lucas", "daniel"].map(u));
  const now = Date.now();
  const wallet = (k: keyof typeof keys) => ({ walletAddress: addr(k), walletVerified: true, walletVerifiedAt: new Date() });
  await db.user.update({ where: { id: valeria.id }, data: { ...wallet("valeria"), onboardedAt: new Date(), linkX: "https://x.com/valeria_rails" } });
  await db.user.update({ where: { id: tomas.id }, data: { ...wallet("tomas"), farcasterFid: 502, farcasterUsername: "tomasreyes", farcasterVerified: true } });
  await db.user.update({ where: { id: priya.id }, data: { ...wallet("priya"), farcasterFid: 503, farcasterUsername: "priya", farcasterVerified: true, linkX: "https://x.com/priya_tokenizes" } });
  await db.user.update({ where: { id: mei.id }, data: wallet("mei") });
  await db.user.update({ where: { id: lucas.id }, data: { linkX: "https://x.com/lucas_atlas" } });
  await db.user.create({ data: { name: "Connect Admin", handle: "connect_admin", isDemo: true, headline: "Moderation", onboardedAt: new Date(), ...wallet("admin") } });

  // Fictional organizations for the fictional people (preview DB only), with approved claims.
  for (const [who, name, slug] of [[valeria, "Quetzal Rails", "quetzal-rails"], [tomas, "Banco Meridiano", "banco-meridiano"], [priya, "Harbor Asset Management", "harbor-asset-management"], [mei, "Keystone Custody", "keystone-custody"]] as const) {
    const org = await db.organization.create({ data: { slug, name, type: "fintech", notes: "Fictional demo organization." } });
    await db.orgClaim.create({ data: { userId: who.id, orgId: org.id, title: who.headline, status: "approved", decidedAt: new Date(), decidedBy: addr("admin") } });
    await db.user.update({ where: { id: who.id }, data: { orgId: org.id } });
  }

  // Feed contrast: a fresh engagement-bait post with lots of likes and no replies, and a live conversation.
  const channels = Object.fromEntries((await db.channel.findMany()).map((c) => [c.slug, c.id]));
  const everyone = await db.user.findMany({ where: { isDemo: true }, select: { id: true } });
  const bait = await db.post.create({ data: { authorId: lucas.id, channelId: channels.stablecoins, body: "RT if you think stablecoins flip card rails by 2027. Giveaway for 3 random reposters, tag a friend!", createdAt: new Date(now - 0.4 * 3600_000) } });
  await db.like.createMany({ data: everyone.slice(0, 8).map((x) => ({ userId: x.id, postId: bait.id })) });
  await db.recast.createMany({ data: everyone.slice(0, 5).filter((x) => x.id !== lucas.id).map((x) => ({ userId: x.id, postId: bait.id, createdAt: new Date(now - 0.3 * 3600_000) })) });
  const convo = await db.post.create({ data: { authorId: mei.id, channelId: channels.custody, kind: "insight", body: "Question for bank folks: when your risk team reviews a custodian, who signs off on the key ceremony evidence, ops or security? We see it stall in both.", createdAt: new Date(now - 9 * 3600_000) } });
  const replies = [
    [tomas, "Security owns it at Meridiano, ops only attests. Took us two quarters to learn that."],
    [daniel, "Same at most clients I advise. Put a named owner in the RFP or it drifts."],
    [priya, "For funds it is the transfer agent's auditors, which surprises everyone."],
    [valeria, "We send a one-page ceremony summary up front. Cut the back-and-forth in half."],
    [tomas, "@valeria could you share that template? Happy to swap ours."],
  ] as const;
  for (const [i, [who, body]] of replies.entries()) {
    await db.post.create({ data: { authorId: who.id, parentId: convo.id, rootId: convo.id, body, createdAt: new Date(now - (8 - i) * 3600_000) } });
  }
  await db.like.createMany({ data: [tomas, priya].map((x) => ({ userId: x.id, postId: convo.id })) });

  // Clean slate for the importers: Valeria does not follow these people yet.
  await db.followUser.deleteMany({ where: { followerId: valeria.id, followeeId: { in: [tomas.id, priya.id, mei.id, lucas.id] } } });
  await db.channelMember.deleteMany({ where: { userId: valeria.id, channel: { slug: "monad" } } });
  // An intro Valeria made (she was the connector), accepted.
  await db.intro.create({ data: { requesterId: tomas.id, connectorId: valeria.id, targetId: priya.id, status: "accepted", reason: "Tokenized deposits pilot", message: "Intro please", provider: "mock", respondedAt: new Date() } });
  // Priya and Mei follow Valeria (their own signed follows show on her public graph).
  await db.followUser.createMany({ data: [{ followerId: priya.id, followeeId: valeria.id }, { followerId: mei.id, followeeId: valeria.id }] });
}


/**
 * On each app page (390x844): with the page scrolled to the end, no button, link-button or
 * form control may sit under the floating tab bar; and sticky action bars must stay clear of
 * it at every scroll position. Returns human-readable failures.
 */
async function checkTabBar(page: Page, db: PrismaClient): Promise<string[]> {
  const post = await db.post.findFirstOrThrow({ where: { parentId: null, replies: { some: {} } }, select: { id: true } });
  const opp = await db.opportunity.findFirst({ select: { id: true } });
  const pages = ["/", "/opportunities", "/circle", "/updates", "/updates?tab=all", "/channels", "/channels/stablecoins", "/compose", "/import", "/sync", "/profile", "/more", "/intros", "/pipeline", "/directory", "/orgs", "/orgs/quetzal-rails", "/signals", "/u/valeria", `/post/${post.id}`, ...(opp ? [`/opportunities/${opp.id}`] : [])];
  const failures: string[] = [];
  // tsx (esbuild keepNames) wraps the named helpers below in __name(); give the page a no-op one.
  await page.addInitScript("window.__name = (f) => f");
  for (const url of pages) {
    await page.goto(`${BASE}${url}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.querySelector("[data-testid=feed-picker] details")?.setAttribute("open", ""));
    await page.waitForTimeout(300);
    const steps = await page.evaluate(() => Math.ceil((document.documentElement.scrollHeight - innerHeight) / 200));
    for (let i = 0; i <= steps; i++) {
      const atEnd = i === steps;
      const hits = await page.evaluate((end) => {
        window.scrollTo(0, end ? document.documentElement.scrollHeight : window.scrollY + 200);
        const nav = document.querySelector("nav[aria-label=Primary]");
        if (!nav || getComputedStyle(nav).display === "none") return [];
        const bar = nav.getBoundingClientRect();
        // The part of an element actually on screen: clipped by every scrolling/clipping ancestor.
        const visibleRect = (el: Element) => {
          const r = el.getBoundingClientRect();
          let { top, bottom, left, right } = r;
          for (let a = el.parentElement; a; a = a.parentElement) {
            const o = getComputedStyle(a);
            if (o.overflowX === "visible" && o.overflowY === "visible") continue;
            const c = a.getBoundingClientRect();
            top = Math.max(top, c.top);
            bottom = Math.min(bottom, c.bottom);
            left = Math.max(left, c.left);
            right = Math.min(right, c.right);
          }
          return { top, bottom, left, right };
        };
        const under = (el: Element) => {
          const r = visibleRect(el);
          return r.bottom - r.top > 1 && r.right - r.left > 1 && r.bottom > bar.top + 1 && r.top < bar.bottom && r.right > bar.left && r.left < bar.right;
        };
        const label = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 40)}"`;
        const out: string[] = [];
        // Sticky action bars: never under the bar.
        for (const el of document.querySelectorAll("[data-testid=import-actions], [data-testid=graph-sign], [data-testid=feed-mutes-actions]")) if (under(el)) out.push(`sticky ${label(el)}`);
        if (end) {
          const controls = document.querySelectorAll("main button, main a.btn, main a[class*=btn-], main input:not([type=hidden]):not(.sr-only), main select, main textarea");
          for (const el of controls) if (!nav.contains(el) && !el.closest("[role=dialog], details:not([open])") && under(el)) out.push(label(el));
        }
        return out;
      }, atEnd);
      for (const h of hits) failures.push(`${url}${atEnd ? " (end)" : ` (scroll ${i * 200})`}: ${h}`);
      if (atEnd) break;
    }
  }
  return [...new Set(failures)];
}

/* ---------- verification screenshot ---------- */
function runVerify(args: string[]): string {
  const r = spawnSync("npx", ["tsx", "scripts/verify-graph.ts", ...args], { encoding: "utf8" });
  return `$ npx tsx scripts/verify-graph.ts ${args.join(" ").replace(/\/tmp\/[^ ]+/, "graph.json")}\n${(r.stdout + r.stderr).trim()}\n(exit ${r.status})`;
}
const VERIFY_HEAD = { title: "Verify the signed graph", lead: "Anyone can run this against the public API. It uses the repo's own EIP-712 definitions, not the server's." };
function terminalHtml(blocks: { title: string; text: string; ok: boolean; label?: string }[], head = VERIFY_HEAD) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const color = (line: string) =>
    /^(ok|RESULT: all)/.test(line) ? `<span style="color:#86efac">${esc(line)}</span>` : /FAIL/.test(line) ? `<span style="color:#fca5a5">${esc(line)}</span>` : line.startsWith("$") ? `<span style="color:#c4b5fd">${esc(line)}</span>` : esc(line);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
    body{margin:0;background:#f6f5f9;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17151f;padding:18px}
    h1{font-size:19px;margin:6px 4px 4px} p{color:#55506a;font-size:13.5px;margin:0 4px 14px;line-height:1.45}
    .card{background:#fff;border:1px solid #e8e5ef;border-radius:22px;padding:12px;margin-bottom:14px;box-shadow:0 12px 32px -14px rgb(76 29 149/.18)}
    .t{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin:2px 4px 10px}
    .pill{font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 9px}
    pre{margin:0;background:#17151f;color:#e9e5f5;border-radius:14px;padding:12px;font:11px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all}
  </style></head><body><h1>${esc(head.title)}</h1><p>${esc(head.lead)}</p>
  ${blocks.map((b) => `<div class="card"><div class="t">${esc(b.title)} <span class="pill" style="background:${b.ok ? "#ede9fe;color:#5b21b6" : "#fee2e2;color:#dc2626"}">${b.label ?? (b.ok ? "passed" : "failed, as expected")}</span></div><pre>${b.text.split("\n").map(color).join("\n")}</pre></div>`).join("")}
  </body></html>`;
}

async function main() {
  await createPreviewDb();
  const db = new PrismaClient({ datasources: { db: { url: DB } } });
  await seedScenario(db);
  const mock = startMock();
  const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: {
      ...process.env,
      DATABASE_URL: DB,
      AUTH_SESSION_SECRET: randomBytes(32).toString("hex"),
      ADMIN_WALLETS: keys.admin.address,
      FARCASTER_HUB_URL: MOCK,
      NEYNAR_API_KEY: "",
      MONAD_RPC_URL: `${MOCK}/rpc`,
      STORAGE_DRIVER: "local",
    },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {}
    mock.close();
  };
  try {
    await waitForServer();
    // Compile every route once, one at a time, before the run: next dev compiles on demand and
    // can serve a half-written manifest when two compiles overlap.
    for (const route of ["/updates", "/channels/stablecoins", "/import", "/sync", "/graph", "/graph/valeria", "/api/graph/events", "/api/graph/users/valeria", "/api/graph/pending", "/api/auth/nonce"]) {
      await fetch(`${BASE}${route}`, { redirect: "manual" }).catch(() => {});
    }
    await fetch(`${BASE}/api/graph/sign`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }).catch(() => {});
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light", locale: "en-US" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    await login(page.request, keys.valeria);

    /* ----- 1. programmable feed ----- */
    await page.goto(`${BASE}/updates?tab=all`);
    await snap(page, "feed-latest");
    await click(page, "[data-testid=feed-picker] summary");
    await click(page, "input[name=topics][value=custody]");
    await snap(page, "feed-picker-tune");
    for (const [id, name] of [["conversations", "feed-conversations"], ["high_signal", "feed-high-signal"], ["no_bait", "feed-no-bait"]] as const) {
      const chosen = `[data-testid=feed-picker] form:has(input[value=${id}]) button[aria-checked=true]`;
      for (let attempt = 1; ; attempt++) {
        await page.locator(`[data-testid=feed-picker] form:has(input[value=${id}]) button`).click();
        const ok = await page.waitForSelector(chosen, { timeout: 12_000 }).then(() => true, () => false);
        if (ok) break;
        // next dev sometimes fails a server action while it recompiles; reload and try again.
        if (attempt === 3) throw new Error(`feed ${id} was not selected`);
        console.warn(`feed ${id}: not selected yet, retrying`);
        await page.reload();
        await page.waitForLoadState("networkidle");
      }
      await snap(page, name);
    }
    await page.goto(`${BASE}/channels/stablecoins?feed=no_bait`);
    await snap(page, "feed-channel");

    /* ----- 2. importers ----- */
    await page.goto(`${BASE}/import`);
    await snap(page, "import-start");
    await page.fill("#farcaster input[name=username]", "valeria");
    await Promise.all([page.waitForURL(/ran=farcaster/), click(page, "#farcaster form button")]);
    await snap(page, "import-farcaster", { scrollTo: "#farcaster" });

    const tmp = mkdtempSync(path.join(tmpdir(), "connect-x-"));
    const following = path.join(tmp, "following.js");
    const account = path.join(tmp, "account.js");
    writeFileSync(following, `window.YTD.following.part0 = [\n${["priya_tokenizes", "lucas_atlas"].map((h, i) => `{ "following": { "accountId": "90${i}", "userLink": "https://twitter.com/intent/user?user_id=90${i}&screen_name=${h}" } }`).concat(["1001", "1002", "1003"].map((id) => `{ "following": { "accountId": "${id}", "userLink": "https://twitter.com/intent/user?user_id=${id}" } }`)).join(",\n")}\n]`);
    writeFileSync(account, `window.YTD.account.part0 = [ { "account": { "accountId": "777", "username": "valeria_rails" } } ]`);
    await page.setInputFiles("#x input[type=file]", [following, account]);
    await snap(page, "import-x-picked", { scrollTo: "#x" });
    await Promise.all([page.waitForURL(/ran=x/), click(page, "#x form button")]);

    await Promise.all([page.waitForURL(/ran=wallet/), click(page, "#wallet form button")]);
    await snap(page, "import-wallet", { scrollTo: "#wallet" });
    await snap(page, "import-suggestions", { scrollTo: "#suggestions", offset: 60 });
    await settle(page);
    await page.evaluate(() => {
      document.querySelector("[data-testid=import-suggestions] form button:not([formaction])")?.scrollIntoView({ block: "end" });
      window.scrollBy(0, 120); // clear the floating tab bar
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path: file("import-suggestions-confirm"), type: "png" });
    console.log("wrote", file("import-suggestions-confirm"));
    await Promise.all([page.waitForURL(/followed=/), click(page, "[data-testid=import-suggestions] form button:not([formaction])")]);
    await snap(page, "import-followed");

    /* ----- 3. signed graph ----- */
    await page.goto(`${BASE}/sync`);
    await snap(page, "graph-pending");
    await snap(page, "graph-pending-list", { scrollTo: "[data-testid=graph-pending]", offset: 16 });

    const others: [keyof typeof keys, APIRequestContext][] = [];
    for (const k of ["tomas", "priya", "mei", "admin"] as const) {
      const api = await request.newContext({ baseURL: BASE });
      await login(api, keys[k]);
      others.push([k, api]);
    }
    console.log("valeria signed", await signGraph(page.request, keys.valeria));
    for (const [k, api] of others) console.log(`${k} signed`, await signGraph(api, keys[k]));

    await page.goto(`${BASE}/sync`);
    await snap(page, "graph-signed");
    await page.goto(`${BASE}/graph`);
    await snap(page, "graph-public");
    await snap(page, "graph-public-verify", { scrollTo: "[data-testid=graph-verify]", offset: 380 });
    await page.goto(`${BASE}/graph/valeria`);
    await snap(page, "graph-member");
    const apiJson = await (await page.request.get(`${BASE}/api/graph/users/valeria`)).json();
    // Excerpt: the protocol block (domain + types, checked by the verifier) is left out to fit the screen.
    const { protocol: _protocol, ...rest } = apiJson as Record<string, unknown>;
    void _protocol;
    const pretty = JSON.stringify(rest, null, 2).replace(/0x[0-9a-f]{20,}/gi, (h) => `${h.slice(0, 8)}…${h.slice(-4)}`);
    await page.setContent(terminalHtml([{ title: "GET /api/graph/users/valeria", text: pretty, ok: true, label: "public, no key" }], { title: "Public graph API", lead: "Read-only, paginated, CORS-enabled. Every event carries its signature and is re-verified on read. Excerpt: protocol block omitted, long hex shortened." }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: file("graph-api-json"), type: "png" });
    console.log("wrote", file("graph-api-json"));

    // The verifier, run like anyone would: once clean, once on a tampered copy of the log.
    const dumpPath = path.join(tmp, "graph.json");
    const clean = runVerify(["--base", BASE, "--user", "valeria", "--save", dumpPath]);
    const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as { events: { action: string; subject: string }[] };
    const victim = dump.events.find((e) => e.action === "follow")!;
    victim.subject = "0x000000000000000000000000000000000000dead";
    writeFileSync(dumpPath, JSON.stringify(dump));
    const tamperedReal = spawnSync("npx", ["tsx", "scripts/verify-graph.ts", "--file", dumpPath], { encoding: "utf8" });
    const tamperedText = `$ npx tsx scripts/verify-graph.ts --file graph-tampered.json\n${(tamperedReal.stdout + tamperedReal.stderr).trim()}\n(exit ${tamperedReal.status})`;
    await page.setContent(terminalHtml([
      { title: "Public log, as served", text: clean, ok: /all checks passed/.test(clean) },
      { title: "Same log, one follow edited", text: tamperedText, ok: false },
    ]));
    await page.waitForTimeout(300);
    await page.screenshot({ path: file("graph-verify"), type: "png", fullPage: true });
    console.log("wrote", file("graph-verify"));
    console.log("\n" + clean + "\n\n" + tamperedText);

    /* ----- 4. layout check: the floating tab bar never covers an action ----- */
    const problems = await checkTabBar(page, db);
    if (problems.length) {
      console.error("\ntab bar overlaps:\n" + problems.join("\n"));
      process.exitCode = 1;
    } else console.log("\ntab bar check: no action covered on any checked page");

    for (const [, api] of others) await api.dispose();
    await browser.close();
  } finally {
    await db.$disconnect();
    stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
