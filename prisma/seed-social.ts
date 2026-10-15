import type { PrismaClient } from "@prisma/client";
import { extractCashtags } from "../src/lib/tagging";
import { extractMentions } from "../src/lib/posts";

/**
 * Demo social graph. EVERY person here is fictional and flagged isDemo (shown
 * with a "Demo" badge). Their employers are fictional companies. Real
 * organizations appear only as $tags in questions/opinions — no invented facts
 * about them.
 */
export const CHANNELS = [
  { slug: "stablecoins", name: "Stablecoins", description: "Issuance, rails, reserves and regulation." },
  { slug: "tokenization", name: "Tokenization", description: "Tokenized deposits, funds and securities." },
  { slug: "rwa", name: "RWA", description: "Real-world assets onchain: issuers, transfer agents, distribution." },
  { slug: "latam-payments", name: "LatAm payments", description: "SPEI, PIX, remittance corridors and on/off-ramps." },
  { slug: "custody", name: "Custody", description: "Qualified custody, MPC, staking and ops." },
  { slug: "monad", name: "Monad", description: "Building and partnering in the Monad ecosystem." },
  { slug: "market-structure", name: "Market structure", description: "Exchanges, clearing, settlement and market infra." },
  { slug: "bd-craft", name: "BD craft", description: "Playbooks, outreach, procurement and closing institutional deals." },
];

const DEMO_USERS = [
  { handle: "valeria", name: "Valeria Ortiz", headline: "Head of Partnerships", orgName: "Quetzal Rails", location: "Mexico City", bio: "Building stablecoin payout rails for SMEs. Ex-payments ops." },
  { handle: "tomas", name: "Tomás Reyes", headline: "Digital Assets Lead", orgName: "Banco Meridiano", location: "Bogotá", bio: "Taking a mid-size bank from tokenization pilots to production." },
  { handle: "priya", name: "Priya Nair", headline: "Tokenization Product Manager", orgName: "Harbor Asset Management", location: "New York", bio: "Tokenized funds, transfer-agent workflows, distribution." },
  { handle: "lucas", name: "Lucas Ferreira", headline: "Ecosystem BD", orgName: "Atlas L1 Foundation", location: "São Paulo", bio: "Bringing payments and RWA builders to an L1 ecosystem." },
  { handle: "mei", name: "Mei Chen", headline: "Custody Solutions Director", orgName: "Keystone Custody", location: "Singapore", bio: "Institutional custody, MPC and staking ops across APAC." },
  { handle: "daniel", name: "Daniel Okafor", headline: "Digital Assets Advisor", orgName: "Clearwater Advisory", location: "London", bio: "Advising banks and market infra on chain selection." },
  { handle: "sofia", name: "Sofía Martínez", headline: "Founder & CEO", orgName: "Pesito", location: "Guadalajara", bio: "Remittances US→MX for families, built on stablecoins." },
  { handle: "james", name: "James Whitfield", headline: "Market Structure Analyst", orgName: "Ridgeline Research", location: "Chicago", bio: "Clearing, settlement cycles and the tokenized collateral debate." },
];

const CONNECTIONS: [string, string][] = [
  ["demo", "valeria"], ["demo", "priya"], ["demo", "lucas"], ["demo", "sofia"],
  ["valeria", "tomas"], ["valeria", "sofia"], ["priya", "mei"], ["priya", "james"],
  ["lucas", "tomas"], ["daniel", "mei"], ["daniel", "tomas"], ["sofia", "lucas"], ["james", "daniel"],
];
const ONE_WAY: [string, string][] = [["demo", "daniel"], ["mei", "demo"], ["james", "demo"]];

const MEMBERSHIPS: Record<string, string[]> = {
  demo: ["stablecoins", "latam-payments", "monad", "bd-craft"],
  valeria: ["stablecoins", "latam-payments", "bd-craft"],
  tomas: ["tokenization", "custody", "bd-craft"],
  priya: ["rwa", "tokenization"],
  lucas: ["monad", "latam-payments", "bd-craft"],
  mei: ["custody", "rwa"],
  daniel: ["market-structure", "tokenization", "bd-craft"],
  sofia: ["latam-payments", "stablecoins"],
  james: ["market-structure", "stablecoins"],
};

type SeedPost = {
  key: string;
  by: string;
  body: string;
  kind?: string;
  channel?: string;
  hoursAgo: number;
  replyTo?: string;
  quote?: string;
  likes?: string[];
  recasts?: string[];
};

const POSTS: SeedPost[] = [
  { key: "val1", by: "valeria", kind: "looking_for_partner", channel: "latam-payments", hoursAgo: 3, body: "Looking for a custody partner for an MXN↔USD stablecoin payout pilot. 3-month scope, sandbox first. Who has been through procurement with a regulated custodian? cc @mei", likes: ["demo", "sofia", "lucas", "tomas"], recasts: ["sofia"] },
  { key: "tom1", by: "tomas", kind: "insight", channel: "tokenization", hoursAgo: 7, body: "Bank lesson #1: the chain is rarely the first question. Legal opinion on settlement finality → custody model → ops runbook → then chain. Order your pitch deck the same way.", likes: ["demo", "valeria", "daniel", "priya", "james"], recasts: ["demo", "daniel"] },
  { key: "pri1", by: "priya", kind: "hiring", channel: "rwa", hoursAgo: 11, body: "Hiring: solutions engineer for tokenized fund ops — transfer-agent workflows + EVM. Remote, Americas time zones. Reply or DM.", likes: ["mei", "james"] },
  { key: "luc1", by: "lucas", kind: "launch", channel: "monad", hoursAgo: 15, body: "Atlas L1 ecosystem fund round 2 is open: payments and RWA builders in LatAm, up to 6 months of runway + BD support. Applications close end of month.", likes: ["demo", "sofia"], recasts: ["valeria"] },
  { key: "mei1", by: "mei", kind: "insight", channel: "custody", hoursAgo: 20, body: "What institutions actually ask custodians first: segregation model, insurance scope, key ceremony evidence, and exit plan. Rarely throughput. Have those four answers ready.", likes: ["priya", "tomas", "daniel", "demo"] },
  { key: "dan1", by: "daniel", kind: "insight", channel: "market-structure", hoursAgo: 26, body: "Advisors shape shortlists more than BD outreach does. If the consultancy writing the evaluation memo hasn't heard of you, you're not on it. Map the advisors before the bank.", likes: ["tomas", "james", "demo"], recasts: ["james"] },
  { key: "sof1", by: "sofia", kind: "looking_for_partner", channel: "latam-payments", hoursAgo: 30, body: "Has anyone integrated with $bitso business APIs for MXN off-ramp? Looking for lessons learned on reconciliation and SPEI cut-off times. Happy to share ours on the US side.", likes: ["valeria", "demo"] },
  { key: "jam1", by: "james", kind: "insight", channel: "stablecoins", hoursAgo: 34, quote: "mei1", body: "Same pattern on the exchange side: the questions are about operational resilience long before performance.", likes: ["mei"] },
  { key: "demo1", by: "demo", kind: "looking_for_partner", channel: "stablecoins", hoursAgo: 5, body: "Mapping peso stablecoin rails this month. Who's the right person to talk to about settlement pilots at $bitso or $mercado-pago? Warm intros appreciated.", likes: ["valeria", "sofia", "lucas"] },
  { key: "demo2", by: "demo", kind: "insight", channel: "bd-craft", hoursAgo: 40, body: "Esta semana: preparando un memo bilingüe sobre SPEI + stablecoins para equipos de BD. Si te interesa revisarlo, avísame.", likes: ["valeria"] },
  { key: "tom1r1", by: "demo", replyTo: "tom1", hoursAgo: 6, body: "This matches what I hear in Mexico too. Do you share the legal-opinion template with vendors, or is that internal only?", likes: ["tomas"] },
  { key: "tom1r2", by: "tomas", replyTo: "tom1r1", hoursAgo: 5.5, body: "Internal, but we share the question list. Happy to send it — @valeria has seen it too.", likes: ["demo"] },
  { key: "tom1r3", by: "valeria", replyTo: "tom1r2", hoursAgo: 5, body: "Can confirm, it saved us two procurement rounds." },
  { key: "tom1r4", by: "daniel", replyTo: "tom1", hoursAgo: 4, body: "Adding: the ops runbook is where most pilots stall. Budget time for it." },
  { key: "val1r1", by: "mei", replyTo: "val1", hoursAgo: 2, body: "Happy to compare notes. The sandbox-first approach is right; ask for the exit plan early." },
  { key: "demo1r1", by: "sofia", replyTo: "demo1", hoursAgo: 4, body: "Following — we're looking for the same on the remittance side." },
];

export async function seedSocial(prisma: PrismaClient) {
  for (const c of CHANNELS) await prisma.channel.upsert({ where: { slug: c.slug }, update: c, create: c });

  const users: Record<string, string> = {};
  const me = await prisma.user.findUniqueOrThrow({ where: { handle: "demo" } });
  await prisma.user.update({ where: { id: me.id }, data: { isDemo: true, name: "Alex Rivera", headline: "Business Development", location: "Mexico City" } });
  users.demo = me.id;
  for (const u of DEMO_USERS) {
    const data = { ...u, email: `${u.handle}@demo.corridor.local`, isDemo: true, role: u.headline, voice: "" };
    const row = await prisma.user.upsert({ where: { email: data.email }, update: data, create: data });
    users[u.handle] = row.id;
  }
  const demoIds = Object.values(users);

  // Reset previous demo social content (only rows involving demo accounts).
  await prisma.post.deleteMany({ where: { authorId: { in: demoIds } } });
  await prisma.opportunity.deleteMany({ where: { authorId: { in: demoIds } } });
  await prisma.intro.deleteMany({ where: { OR: [{ requesterId: { in: demoIds } }, { connectorId: { in: demoIds } }] } });
  await prisma.followUser.deleteMany({ where: { followerId: { in: demoIds }, followeeId: { in: demoIds } } });
  await prisma.channelMember.deleteMany({ where: { userId: { in: demoIds } } });

  for (const [a, b] of CONNECTIONS) {
    await prisma.followUser.createMany({ data: [{ followerId: users[a], followeeId: users[b] }, { followerId: users[b], followeeId: users[a] }] });
  }
  for (const [a, b] of ONE_WAY) await prisma.followUser.create({ data: { followerId: users[a], followeeId: users[b] } });

  const channels = Object.fromEntries((await prisma.channel.findMany()).map((c) => [c.slug, c.id]));
  for (const [h, slugs] of Object.entries(MEMBERSHIPS)) {
    await prisma.channelMember.createMany({ data: slugs.map((s) => ({ userId: users[h], channelId: channels[s] })) });
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true } });
  const now = Date.now();
  const ids: Record<string, { id: string; rootId: string | null }> = {};
  for (const p of POSTS) {
    const parent = p.replyTo ? ids[p.replyTo] : undefined;
    const orgIds = orgs.filter((o) => extractCashtags(p.body).includes(o.slug)).map((o) => ({ orgId: o.id }));
    const mentionIds = extractMentions(p.body).filter((h) => users[h]).map((h) => ({ userId: users[h] }));
    const row = await prisma.post.create({
      data: {
        authorId: users[p.by],
        body: p.body,
        kind: p.kind ?? "",
        channelId: p.channel ? channels[p.channel] : null,
        parentId: parent?.id ?? null,
        rootId: parent ? (parent.rootId ?? parent.id) : null,
        quoteOfId: p.quote ? ids[p.quote].id : null,
        createdAt: new Date(now - p.hoursAgo * 3600_000),
        orgs: { create: orgIds },
        mentions: { create: mentionIds },
      },
    });
    ids[p.key] = { id: row.id, rootId: row.rootId };
    if (p.likes?.length) await prisma.like.createMany({ data: p.likes.map((h) => ({ userId: users[h], postId: row.id })) });
    if (p.recasts?.length)
      await prisma.recast.createMany({ data: p.recasts.map((h) => ({ userId: users[h], postId: row.id, createdAt: new Date(now - (p.hoursAgo - 0.5) * 3600_000) })) });
  }

  const intro = (r: string, c: string, t: string, status: string, reason: string, message: string, connectorNote = "", hoursAgo = 24) =>
    prisma.intro.create({
      data: {
        requesterId: users[r], connectorId: users[c], targetId: users[t], status, reason, message, connectorNote, provider: "mock",
        createdAt: new Date(now - hoursAgo * 3600_000),
        respondedAt: status === "accepted" || status === "declined" ? new Date(now - (hoursAgo - 2) * 3600_000) : null,
      },
    });
  await intro("sofia", "demo", "priya", "pending", "Learn how tokenized funds handle redemptions for a treasury product.",
    "Hi! Would you be comfortable introducing me to Priya? I'd like to learn how tokenized funds handle redemptions — we're designing a treasury feature at Pesito. No worries if the timing isn't right.\nThanks!\nSofía", "", 3);
  await intro("demo", "priya", "mei", "accepted", "Understand custody requirements for a stablecoin pilot.",
    "Hi Priya, would you be comfortable introducing me to Mei? I'd like to understand custody requirements for a stablecoin pilot.\nThanks!",
    "Mei — Alex is mapping LatAm stablecoin rails and asked great questions on custody. Worth 20 minutes.", 50);
  await intro("valeria", "demo", "lucas", "accepted", "Explore the ecosystem fund for our payout rails.",
    "Hi! Could you introduce me to Lucas? We'd like to explore the ecosystem fund for Quetzal Rails.\nThanks!\nValeria",
    "Lucas — Valeria runs partnerships at Quetzal Rails; strong fit for your payments track.", 70);
  await intro("lucas", "tomas", "daniel", "declined", "Advisor perspective on chain selection.", "Hi Tomás, could you introduce me to Daniel?", "Daniel is heads-down on a client project this quarter — try again in January.", 90);
  await intro("valeria", "demo", "priya", "pending", "Find a tokenized money-market fund partner for SME treasury balances.",
    "Hi! Would you be open to introducing me to Priya? Quetzal Rails wants to offer SMEs a tokenized money-market option for idle balances and I'd value her view on distribution.\nThanks!\nValeria", "", 7);
  await intro("lucas", "demo", "sofia", "pending", "Explore Pesito as a launch partner for the payments grant track.",
    "Hi! Could you introduce me to Sofía? Atlas L1's payments grant track is looking for remittance teams and Pesito looks like a great fit.\nThanks!\nLucas", "", 26);

  // Asks & offers (Opportunities tab). All from the fictional demo companies above.
  const OPPS: { by: string; kind: "ask" | "offer"; headline: string; body: string; region: string; hoursAgo: number }[] = [
    { by: "tomas", kind: "ask", headline: "Banco Meridiano is evaluating 2 chains", region: "latam", hoursAgo: 5,
      body: "Looking for intros to teams running tokenized-deposit pilots in production." },
    { by: "mei", kind: "offer", headline: "Keystone Custody is opening APAC custody pilots", region: "apac", hoursAgo: 9,
      body: "Offering sandbox access to funds and fintechs tokenizing out of Singapore." },
    { by: "sofia", kind: "ask", headline: "Pesito is raising a seed round", region: "latam", hoursAgo: 20,
      body: "Seeking intros to fintech funds that back US→MX remittance products." },
    { by: "lucas", kind: "offer", headline: "Atlas L1 Foundation has a payments grant track", region: "latam", hoursAgo: 30,
      body: "Grants and go-to-market help for stablecoin payout and on/off-ramp builders." },
    { by: "priya", kind: "ask", headline: "Harbor Asset Management needs a transfer-agent partner", region: "north_america", hoursAgo: 44,
      body: "Open to intros to onchain transfer agents for a tokenized fund share class." },
    { by: "daniel", kind: "offer", headline: "Clearwater Advisory runs chain-selection workshops", region: "europe", hoursAgo: 60,
      body: "Half-day sessions for bank teams comparing settlement networks. Vendor-neutral." },
    { by: "valeria", kind: "ask", headline: "Quetzal Rails wants a regulated custodian", region: "latam", hoursAgo: 72,
      body: "MXN↔USD stablecoin payout pilot, sandbox first. Intros to custody teams welcome." },
    { by: "james", kind: "offer", headline: "Ridgeline Research is sharing a settlement-cycle study", region: "north_america", hoursAgo: 96,
      body: "Happy to walk market-infra teams through the findings on tokenized collateral." },
  ];
  for (const o of OPPS) {
    const author = DEMO_USERS.find((u) => u.handle === o.by)!;
    await prisma.opportunity.create({
      data: { authorId: users[o.by], kind: o.kind, headline: o.headline, body: o.body, region: o.region, orgName: author.orgName, createdAt: new Date(now - o.hoursAgo * 3600_000) },
    });
  }
  console.log(`Seeded ${DEMO_USERS.length} demo users, ${CHANNELS.length} channels, ${POSTS.length} demo posts, 6 intros, ${OPPS.length} opportunities.`);
}
