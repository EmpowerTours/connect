/**
 * Connect protocol relayer: its own process and Railway service (design section 15.4). It is the
 * only Connect code that sends transactions, and only from its own hot wallet; it lives outside
 * src/ so the web app can never sign or send one (tests/ecosystem-wallet.test.ts).
 *
 *   POST /relay/register   { user: { id, wallet }, ipHash, payload }   (Bearer RELAYER_SERVICE_TOKEN)
 *   POST /relay/action     same shape
 *   GET  /health           liveness (no auth)
 *   GET  /status           relayer address, chain, balance, 24 h spend (Bearer token)
 *
 * The web app says who is asking; this service re-checks the account (verified Mera wallet) and
 * the sponsorship grant in Postgres, then applies every spend rule (policy.ts) itself.
 * The key is read once from RELAYER_KEY / RELAYER_KEY_FILE and never logged; only the address is.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createPublicClient, getAddress, http, type PublicClient } from "viem";
import { viemChain } from "../src/lib/protocol/chains";
import { resolveProtocolConfig } from "../src/lib/protocol/config";
import { checkRelayerServiceEnv } from "../src/lib/protocol/env-check";
import { ActionPayloadSchema, RegisterPayloadSchema } from "../src/lib/protocol/payloads";
import { ProtocolReader } from "../src/lib/protocol/reader";
import { sponsorEligibility } from "../src/lib/protocol/relayer/eligibility";
import { loadRelayerAccount } from "../src/lib/protocol/relayer/key";
import { DAY_MS } from "../src/lib/protocol/relayer/ledger";
import { PrismaRelayLedger } from "../src/lib/protocol/relayer/ledger-db";
import { relayerLimitsFromEnv } from "../src/lib/protocol/relayer/policy";
import { Relayer, type RelayLog } from "../src/lib/protocol/relayer/service";
import { viemRelayChain } from "./chain-viem";

const MAX_BODY = 16 * 1024;

const log: RelayLog = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: "info", msg, ...ctx, ts: new Date().toISOString() })),
  warn: (msg, ctx) => console.warn(JSON.stringify({ level: "warn", msg, ...ctx, ts: new Date().toISOString() })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: "error", msg, ...ctx, ts: new Date().toISOString() })),
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, token: string): boolean {
  const got = Buffer.from(String(req.headers.authorization ?? ""));
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

async function main() {
  const env = process.env;
  const check = checkRelayerServiceEnv(env);
  if (check.errors.length) {
    log.error("[relayer] refusing to start", { problems: check.errors });
    process.exit(1);
  }
  const config = resolveProtocolConfig(env);
  const vchain = viemChain(config.chain, config.rpcUrl);
  const client = createPublicClient({ chain: vchain, transport: http(config.rpcUrl, { timeout: 15_000 }) }) as PublicClient;
  const problems = await new ProtocolReader(client, config.deployment).verifyDeployment();
  if (problems.length) {
    log.error("[relayer] deployment file does not match the chain", { problems });
    process.exit(1);
  }
  const account = loadRelayerAccount(env);
  const { limits } = relayerLimitsFromEnv(env);
  const db = new PrismaClient();
  const ledger = new PrismaRelayLedger(db);
  const relayer = new Relayer(viemRelayChain(client, vchain, config.rpcUrl, account, config.deployment), ledger, limits, log, config.deployment.gateway);
  const token = env.RELAYER_SERVICE_TOKEN as string;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://relayer");
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
      if (!authorized(req, token)) return send(res, 401, { error: "unauthorized" });
      if (req.method === "GET" && url.pathname === "/status") {
        const [balance, spent] = await Promise.all([client.getBalance({ address: account.address }), ledger.spentSince(config.chain.id, new Date(Date.now() - DAY_MS))]);
        return send(res, 200, { address: account.address, chainId: config.chain.id, gateway: config.deployment.gateway, balanceWei: balance.toString(), spent24hWei: spent.toString(), dailyCapWei: limits.dailyCapWei.toString(), balanceCapWei: limits.balanceCapWei.toString() });
      }
      if (req.method !== "POST" || (url.pathname !== "/relay/register" && url.pathname !== "/relay/action")) return send(res, 404, { error: "not found" });

      const body = (await readBody(req)) as { user?: { id?: unknown; wallet?: unknown }; ipHash?: unknown; payload?: unknown } | null;
      const userId = typeof body?.user?.id === "string" ? body.user.id : "";
      const wallet = typeof body?.user?.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.user.wallet) ? body.user.wallet.toLowerCase() : "";
      const ipHash = typeof body?.ipHash === "string" && /^[0-9a-f]{1,64}$/.test(body.ipHash) ? body.ipHash : null;
      if (!userId || !wallet) return send(res, 400, { error: "invalid payload" });
      // Re-check the account: it must exist with this verified Mera wallet.
      const user = await db.user.findUnique({ where: { id: userId }, select: { walletAddress: true, walletVerified: true } });
      if (!user || !user.walletVerified || user.walletAddress?.toLowerCase() !== wallet) return send(res, 403, { error: "unknown account" });
      const eligibility = await sponsorEligibility(db, userId);
      const member = { id: userId, wallet: getAddress(wallet).toLowerCase() };

      let r;
      if (url.pathname === "/relay/register") {
        const p = RegisterPayloadSchema.safeParse(body?.payload);
        if (!p.success) return send(res, 400, { error: "invalid payload" });
        r = await relayer.relayRegister(member, eligibility, ipHash, p.data);
      } else {
        const p = ActionPayloadSchema.safeParse(body?.payload);
        if (!p.success) return send(res, 400, { error: "invalid payload" });
        r = await relayer.relayAction(member, eligibility, ipHash, p.data);
      }
      if (!r.ok) return send(res, r.status, { error: r.reason, code: r.code, selfPay: r.selfPay });
      return send(res, r.status === "confirmed" ? 201 : 202, r);
    } catch (e) {
      log.error("[relayer] request failed", { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      return send(res, 500, { error: "relayer error" });
    }
  });

  const port = Number(env.PORT ?? 8080);
  server.listen(port, () => log.info("[relayer] listening", { port, chainId: config.chain.id, gateway: config.deployment.gateway, relayer: account.address }));
  const stop = () => server.close(() => void db.$disconnect().finally(() => process.exit(0)));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e: unknown) => {
  log.error("[relayer] crashed", { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
  process.exit(1);
});
