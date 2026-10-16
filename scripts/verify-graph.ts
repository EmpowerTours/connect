/**
 * Verify the Connect signed graph yourself. Read-only; needs no account,
 * no key and no chain access — only the public API (or a saved JSON dump).
 *
 *   npx tsx scripts/verify-graph.ts --base https://connect.empowertours.xyz
 *   npx tsx scripts/verify-graph.ts --base http://localhost:3000 --user ana
 *   npx tsx scripts/verify-graph.ts --file graph.json --admins 0xabc…,0xdef…
 *   npx tsx scripts/verify-graph.ts --base … --save graph.json
 *
 * Checks, using this repository's EIP-712 definitions (not the server's):
 *   1. the server advertises the same domain, types and statement;
 *   2. every signature recovers to its author over exactly that message;
 *   3. each author's seq runs 1, 2, 3, … with no duplicates or gaps;
 *   4. approve_member / revoke_member are signed by an admin wallet
 *      (--admins overrides the server's list, so you need not trust it).
 * Then it replays the log and prints the resulting graph. Exit code 1 on any failure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GRAPH_DOMAIN, GRAPH_STATEMENT, GRAPH_TYPES } from "../src/lib/graph/typed-data";
import { checkGraphLog, logIsClean, verifiedMemberships, type SignedGraphEvent } from "../src/lib/graph/verify";

type Dump = { protocol?: { domain?: unknown; types?: unknown; statement?: string; admins?: string[] }; events: SignedGraphEvent[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function fetchAll(base: string): Promise<Dump> {
  const events: SignedGraphEvent[] = [];
  let protocol: Dump["protocol"];
  let cursor = 0;
  for (let page = 0; page < 10_000; page++) {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/graph/events?cursor=${cursor}&limit=100`);
    if (!res.ok) throw new Error(`GET /api/graph/events -> HTTP ${res.status}`);
    const body = (await res.json()) as Dump & { nextCursor: number | null };
    protocol ??= body.protocol;
    events.push(...body.events);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return { protocol, events };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function main() {
  const base = arg("base");
  const file = arg("file");
  if (!base && !file) {
    console.error("usage: verify-graph.ts --base <url> | --file <dump.json> [--admins 0x..,0x..] [--user <handle|wallet>] [--save <file>]");
    process.exit(2);
  }
  const dump: Dump = file ? (JSON.parse(readFileSync(file, "utf8")) as Dump) : await fetchAll(base!);
  const save = arg("save");
  if (save) writeFileSync(save, JSON.stringify(dump, null, 2));

  let failed = false;
  const p = dump.protocol;
  if (p) {
    const checks: [string, boolean][] = [
      ["domain", same(p.domain, GRAPH_DOMAIN)],
      ["types", same(p.types, GRAPH_TYPES)],
      ["statement", p.statement === GRAPH_STATEMENT],
    ];
    for (const [what, ok] of checks) {
      console.log(`${ok ? "ok  " : "FAIL"} server ${what} matches this repo`);
      if (!ok) failed = true;
    }
  }
  const adminArg = arg("admins");
  const admins = new Set((adminArg ? adminArg.split(",") : (p?.admins ?? [])).map((a) => a.trim().toLowerCase()).filter(Boolean));
  console.log(`admins (${adminArg ? "from --admins" : "as advertised by the server"}): ${[...admins].map(short).join(", ") || "none"}`);

  const r = await checkGraphLog(dump.events, admins);
  console.log(`\n${r.valid}/${r.total} signatures valid`);
  for (const x of r.invalid) console.log(`FAIL event #${x.index} by ${short(x.author)} seq ${x.seq}: ${x.reason}`);
  for (const x of r.sequenceIssues) console.log(`FAIL ${short(x.author)}: ${x.issue} at seq ${x.seq}`);
  for (const x of r.unauthorizedAdmin) console.log(`FAIL ${short(x.author)} seq ${x.seq}: admin action from a non-admin wallet`);
  if (!logIsClean(r)) failed = true;

  const authors = new Set(dump.events.map((e) => e.author.toLowerCase()));
  const follows = [...r.state.following.values()].reduce((n, s) => n + s.size, 0);
  const members = verifiedMemberships(r.state);
  console.log(`\nreplayed graph: ${authors.size} wallets, ${follows} follow edges, ${members.length} verified memberships, ${r.state.intros.length} intros`);

  const user = arg("user")?.toLowerCase();
  if (user) {
    const hinted = dump.events.find((e) => (e as { hints?: { author?: string } }).hints?.author === user.replace(/^@/, ""));
    const wallet = /^0x[0-9a-f]{40}$/.test(user) ? user : hinted?.author.toLowerCase();
    if (!wallet) console.log(`\nno signed updates found for ${user}`);
    else {
      console.log(`\n${user} (${short(wallet)})`);
      console.log(`  following: ${[...(r.state.following.get(wallet) ?? [])].map(short).join(", ") || "—"}`);
      console.log(`  memberships: ${members.filter((m) => m.member === wallet).map((m) => `${m.org} (approved by ${short(m.approvedBy)})`).join(", ") || "—"}`);
      console.log(`  intros made: ${r.state.intros.filter((i) => i.introducer === wallet).length}`);
    }
  }
  console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: all checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
