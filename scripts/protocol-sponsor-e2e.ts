/**
 * `npm run protocol:sponsor-e2e`: free-signup eligibility end to end, on local Monad Solonet and a
 * throwaway embedded Postgres (.data/pg-sponsor-e2e, port 54359 or SPONSOR_E2E_PG_PORT; a new database each run).
 *
 * Real modules throughout: Prisma sponsor store + email/phone checks, invite grants, the relayer
 * service with the Postgres spend ledger, and the viem relay chain against the Solonet dry-run
 * deployment. Codes are captured in memory instead of being emailed.
 *
 * Accounts: public anvil dev accounts only (test mnemonic). Relayer = index 8. Members = the first
 * unregistered indexes from 100. Refuses any chain but 20143. Sends nothing to testnet or mainnet.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { createPublicClient, http, parseEther, type PublicClient } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";

const ROOT = process.cwd();
const PORT = Number(process.env.SPONSOR_E2E_PG_PORT ?? 54359);
// A fresh database per run; the cluster directory is kept (nothing is deleted).
const DB_NAME = `sponsore2e_${Date.now()}`;
const DB_URL = `postgresql://connect:connect-local-only@127.0.0.1:${PORT}/${DB_NAME}`;
const MNEMONIC = "test test test test test test test test test test test junk";
const dev = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const SECRET = "solonet-e2e-sponsor-secret";

let passed = 0;
function check(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${what}`);
  passed++;
  console.log(`✓ ${what}`);
}

async function main() {
  const dir = path.join(ROOT, ".data/pg-sponsor-e2e");
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "connect", password: "connect-local-only", port: PORT, persistent: true });
  if (!existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(DB_NAME);
    execSync("npx prisma migrate deploy", { cwd: ROOT, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: "ignore" });
    process.env.DATABASE_URL = DB_URL;
    await run();
  } finally {
    await pg.stop();
  }
}

async function run() {
  const { PrismaClient } = await import("@prisma/client");
  const { CHAIN_SOLONET, PROTOCOL_CHAINS, protocolRpcUrl, viemChain } = await import("../src/lib/protocol/chains");
  const { loadDeployment } = await import("../src/lib/protocol/deployments");
  const { generateDeviceKey } = await import("../src/lib/protocol/device-key");
  const { RegisterPayloadSchema, toWire } = await import("../src/lib/protocol/payloads");
  const { ProtocolReader } = await import("../src/lib/protocol/reader");
  const { viemRelayChain } = await import("../relayer/chain-viem");
  const { PrismaRelayLedger } = await import("../src/lib/protocol/relayer/ledger-db");
  const { relayerLimitsFromEnv } = await import("../src/lib/protocol/relayer/policy");
  const { Relayer } = await import("../src/lib/protocol/relayer/service");
  const { sponsorEligibility } = await import("../src/lib/protocol/relayer/eligibility");
  const { PrismaSponsorStore } = await import("../src/lib/protocol/sponsor/store");
  const { startCheck, verifyCheck, grantInvite, SEND_LIMITS } = await import("../src/lib/protocol/sponsor/checks");
  const { consoleSender } = await import("../src/lib/protocol/sponsor/senders");
  const { DEVICE_KEY_LIFETIME, KeyType, Scope, ZERO_ADDRESS, protocolDomain, registerTypedData } = await import("../src/lib/protocol/typed-data");

  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  const store = new PrismaSponsorStore(prisma);

  const chain = PROTOCOL_CHAINS[CHAIN_SOLONET];
  const rpc = protocolRpcUrl(chain, process.env.SOLONET_RPC);
  const d = loadDeployment(CHAIN_SOLONET, {});
  const vchain = viemChain(chain, rpc);
  const client = createPublicClient({ chain: vchain, transport: http(rpc) }) as PublicClient;
  check((await client.getChainId()) === CHAIN_SOLONET, "RPC is Solonet 20143");
  const reader = new ProtocolReader(client, d);
  const relayChain = viemRelayChain(client, vchain, rpc, dev(8), d);
  // Dev accounts hold far more than the 100 MON cap; only that cap is lifted. Everything else is the approved value.
  const limits = { ...relayerLimitsFromEnv({}).limits, balanceCapWei: parseEther("1000000000000000000000") };
  const quiet = { info: () => undefined, warn: (m: string) => console.log(`  [warn] ${m}`), error: (m: string) => console.log(`  [alert] ${m}`) };
  const relayer = new Relayer(relayChain, new PrismaRelayLedger(prisma), limits, quiet, d.gateway);
  const domain = protocolDomain(CHAIN_SOLONET, d.gateway);
  const now = async () => Number((await client.getBlock()).timestamp);

  const accounts: HDAccount[] = [];
  for (let i = 100; accounts.length < 5 && i < 600; i++) if ((await reader.idOf(dev(i).address)) === BigInt(0)) accounts.push(dev(i));
  check(accounts.length === 5, "found 5 unregistered public dev accounts (from index 100)");
  const [mEmail, mDup, mInv1, mInv2, mPhone] = accounts;

  let n = 0;
  async function user(wallet?: HDAccount, isDemo = false) {
    n++;
    return prisma.user.create({ data: { name: `E2E ${n}`, handle: `e2e${n}${Date.now()}`, isDemo, walletAddress: wallet?.address.toLowerCase(), walletVerified: !!wallet } });
  }
  async function registerPayload(owner: HDAccount) {
    const device = await generateDeviceKey();
    const params = { owner: owner.address, recovery: ZERO_ADDRESS, keyType: KeyType.P256, key: device.key, scope: Scope.ALL, expiresAt: (await now()) + DEVICE_KEY_LIFETIME, deadline: BigInt((await now()) + 1800) };
    const signature = await owner.signTypedData(registerTypedData(domain, params, await reader.registerNonce(owner.address)));
    return RegisterPayloadSchema.parse(toWire({ params, signature }));
  }
  // The relayer service loads eligibility from Postgres exactly like this (relayer/server.ts).
  async function relayRegister(u: { id: string }, owner: HDAccount, ipHash: string) {
    return relayer.relayRegister({ id: u.id, wallet: owner.address.toLowerCase() }, await sponsorEligibility(prisma, u.id), ipHash, await registerPayload(owner));
  }

  // ------------------------------------------------------------ 1. no grant: not sponsored
  const uEmail = await user(mEmail);
  let r = await relayRegister(uEmail, mEmail, "ip-a");
  check(!r.ok && r.code === "not_eligible", `no invite and no check: relayer refuses (${r.ok ? "ok" : r.code}), member can self-submit`);

  // ------------------------------------------------------------ 2. email check -> sponsored registration
  const inbox: { to: string; code: string }[] = [];
  const email = { channel: "email" as const, provider: "capture", send: async (to: string, code: string) => void inbox.push({ to, code }) };
  const s1 = await startCheck({ store, sender: email, secret: SECRET, userId: uEmail.id, channel: "email", address: "Ana.Lopez+connect@gmail.com", ipHash: "ip-a" });
  check(s1.ok && s1.sentTo === "a•••@gmail.com" && inbox[0].to === "analopez@gmail.com", "email code sent to the normalized address, shown masked");
  const rows = await prisma.protocolSponsorCheck.findMany();
  check(!JSON.stringify(rows).includes("analopez") && !JSON.stringify(rows).includes(inbox[0].code), "database holds only hashes (no email, no code)");
  check((await verifyCheck({ store, secret: SECRET, userId: uEmail.id, code: "000000" === inbox[0].code ? "111111" : "000000" })).ok === false, "wrong code refused");
  const v1 = await verifyCheck({ store, secret: SECRET, userId: uEmail.id, code: inbox[0].code });
  check(v1.ok, "right code: sponsorship granted");
  const grant = await prisma.protocolSponsorship.findUnique({ where: { userId: uEmail.id } });
  check(grant?.source === "verified" && grant.channel === "email" && /^[0-9a-f]{64}$/.test(grant.identityHash ?? ""), "grant stored with the email's hash only");
  r = await relayRegister(uEmail, mEmail, "ip-a");
  check(r.ok && r.status === "confirmed", `sponsored registration after the email check confirmed on Solonet: ${r.ok ? r.txHash : r.code}`);
  check((await reader.idOf(mEmail.address)).toString() === (r as { connectId: string }).connectId, `chain read: Connect ID #${(r as { connectId: string }).connectId}`);
  const relayRow = await prisma.protocolRelay.findFirst({ where: { userId: uEmail.id, type: "register" } });
  check(relayRow?.status === "confirmed" && relayRow.sponsor === "verified", "spend ledger row confirmed in Postgres (sponsor = verified)");

  // ------------------------------------------------------------ 3. same email on another account
  const uDup = await user(mDup);
  await startCheck({ store, sender: email, secret: SECRET, userId: uDup.id, channel: "email", address: "a.n.a.l.o.p.e.z@googlemail.com", ipHash: "ip-b" });
  const v2 = await verifyCheck({ store, secret: SECRET, userId: uDup.id, code: inbox[1].code });
  check(!v2.ok && v2.code === "identity_used", "same inbox (dots + googlemail) on a second account: identity_used");
  r = await relayRegister(uDup, mDup, "ip-b");
  check(!r.ok && r.code === "not_eligible", "second account stays unsponsored");

  // ------------------------------------------------------------ 4. code send limits (Postgres-backed)
  for (let i = 1; i < SEND_LIMITS.memberPerHour; i++) await startCheck({ store, sender: email, secret: SECRET, userId: uDup.id, channel: "email", address: `other${i}@x.com`, ipHash: "ip-b" });
  const limited = await startCheck({ store, sender: email, secret: SECRET, userId: uDup.id, channel: "email", address: "fourth@x.com", ipHash: "ip-b" });
  check(!limited.ok && limited.code === "rate_limited", `member's ${SEND_LIMITS.memberPerHour + 1}th code in an hour refused`);

  // ------------------------------------------------------------ 5. invites
  const inviter = await user();
  const demo = await user(undefined, true);
  const uInv1 = await user(mInv1);
  check((await grantInvite({ store, userId: uInv1.id, inviterId: inviter.id })).granted, "invite sign-up granted sponsorship");
  check(!(await grantInvite({ store, userId: (await user()).id, inviterId: demo.id })).granted, "demo account can't invite");
  r = await relayRegister(uInv1, mInv1, "ip-c");
  check(r.ok && r.status === "confirmed", `sponsored invite registration confirmed on Solonet: ${r.ok ? r.txHash : r.code}`);
  const invRow = await prisma.protocolRelay.findFirst({ where: { userId: uInv1.id, type: "register" } });
  check(invRow?.sponsor === "invite" && invRow.inviterId === inviter.id, "ledger credits the inviter");

  // 25 concurrent invite sign-ups for one inviter: the advisory lock lets exactly 20 through in a day.
  const busy = await user();
  const invitees = await Promise.all(Array.from({ length: 25 }, () => user()));
  const results = await Promise.all(invitees.map((u) => grantInvite({ store, userId: u.id, inviterId: busy.id })));
  const granted = results.filter((x) => x.granted).length;
  check(granted === 20 && results.every((x) => x.granted || x.reason === "inviter_limit"), `25 concurrent invite sign-ups: ${granted} granted, rest inviter_limit`);

  // Relay-time inviter cap (second layer), shown with the cap lowered to 1.
  const uInv2 = await user(mInv2);
  await grantInvite({ store, userId: uInv2.id, inviterId: inviter.id });
  const strict = new Relayer(relayChain, new PrismaRelayLedger(prisma), { ...limits, inviterSignupsPerDay: 1 }, quiet, d.gateway);
  r = await strict.relayRegister({ id: uInv2.id, wallet: mInv2.address.toLowerCase() }, await sponsorEligibility(prisma, uInv2.id), "ip-d", await registerPayload(mInv2));
  check(!r.ok && r.code === "inviter_limit", "relayer also enforces the per-inviter cap from its own ledger");

  // ------------------------------------------------------------ 6. phone through the dev provider
  const uPhone = await user(mPhone);
  const sms: string[] = [];
  const phone = consoleSender("phone", (l) => sms.push(l));
  check((await startCheck({ store, sender: phone, secret: SECRET, userId: uPhone.id, channel: "phone", address: "+52 55 1234 5678", ipHash: "ip-e" })).ok, "phone code sent through the SMS interface (dev provider)");
  const code = sms[0].match(/(\d{6})$/)?.[1] ?? "";
  check((await verifyCheck({ store, secret: SECRET, userId: uPhone.id, code })).ok, "phone check grants sponsorship");
  r = await relayRegister(uPhone, mPhone, "ip-e");
  check(r.ok && r.status === "confirmed", `sponsored registration after the phone check confirmed: ${r.ok ? r.txHash : r.code}`);

  const spent = await prisma.protocolRelay.findMany({ where: { status: "confirmed" } });
  const total = spent.reduce((a, x) => a + BigInt(x.costWei.toFixed()), BigInt(0));
  console.log(`\nrelayer spent ${(Number(total) / 1e18).toFixed(4)} MON over ${spent.length} confirmed tx`);
  await prisma.$disconnect();
  console.log(`\nALL ${passed} CHECKS PASSED`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
