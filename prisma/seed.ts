import { PrismaClient } from "@prisma/client";
import { regionForCountry } from "../src/lib/constants";
import { toList } from "../src/lib/json";
import { DEFAULT_FEEDS } from "../src/lib/rss";
import { slugify } from "../src/lib/slug";
import { SEED_ORGS } from "./seed-data";

const prisma = new PrismaClient();
const DAY = 86_400_000;

async function main() {
  for (const o of SEED_ORGS) {
    const data = {
      name: o.name,
      type: o.type,
      country: o.country,
      region: regionForCountry(o.country),
      website: o.website,
      aliases: toList(o.aliases ?? []),
      chainsInUse: toList(o.chainsInUse ?? []),
      notes: o.notes ?? "",
    };
    await prisma.organization.upsert({ where: { slug: slugify(o.name) }, update: data, create: { slug: slugify(o.name), ...data } });
  }
  for (const f of DEFAULT_FEEDS) {
    await prisma.rssFeed.upsert({ where: { url: f.url }, update: { name: f.name }, create: f });
  }
  console.log(`Seeded ${SEED_ORGS.length} organizations and ${DEFAULT_FEEDS.length} RSS feeds.`);

  if (process.env.SEED_DEMO === "0") return;

  // Demo user + demo pipeline. These are YOUR pipeline entries (stages, tasks),
  // not claims about the institutions. No contacts or competing chains are invented.
  const demo = await prisma.user.upsert({
    where: { email: "demo@corridor.local" },
    update: {},
    create: {
      email: "demo@corridor.local",
      name: "Demo BD Lead",
      handle: "demo",
      role: "Business Development",
      orgName: "EmpowerTours",
      bio: "Mapping LatAm and US institutions for onchain settlement. Built Hunt & Cota on Monad.",
      voice: "Short, direct, friendly. No buzzwords. Bilingual EN/ES.",
    },
  });
  const ws =
    (await prisma.workspace.findFirst({ where: { ownerId: demo.id } })) ??
    (await prisma.workspace.create({ data: { name: "My pipeline", ownerId: demo.id } }));

  const now = Date.now();
  const demoDeals: { slug: string; stage: string; useCase: string; nextAction: string; dueInDays: number | null }[] = [
    { slug: "bitso", stage: "evaluation", useCase: "MXNB settlement on a fast EVM", nextAction: "Send bilingual MXNB/SPEI memo", dueInDays: 3 },
    { slug: "mercado-pago", stage: "awareness", useCase: "Stablecoin payouts", nextAction: "Find digital-assets lead", dueInDays: 7 },
    { slug: "banorte", stage: "awareness", useCase: "", nextAction: "", dueInDays: null },
    { slug: "nubank", stage: "awareness", useCase: "Stablecoin wallet rails", nextAction: "Research public stablecoin announcements", dueInDays: -2 },
    { slug: "ripio", stage: "pilot", useCase: "Remittance corridor test", nextAction: "Agree pilot success metrics", dueInDays: 0 },
    { slug: "cme-group", stage: "awareness", useCase: "Research collaboration", nextAction: "Identify consultancy advising on chain selection", dueInDays: 21 },
    { slug: "fintech-mexico", stage: "evaluation", useCase: "Working-group membership", nextAction: "Apply to speak at next CDMX event", dueInDays: 10 },
    { slug: "fireblocks", stage: "committed", useCase: "Custody support for demo assets", nextAction: "Quarterly check-in", dueInDays: 45 },
  ];
  for (const d of demoDeals) {
    const org = await prisma.organization.findUnique({ where: { slug: d.slug } });
    if (!org) continue;
    const existing = await prisma.deal.findUnique({ where: { workspaceId_orgId: { workspaceId: ws.id, orgId: org.id } } });
    if (existing) continue;
    await prisma.deal.create({
      data: {
        workspaceId: ws.id,
        orgId: org.id,
        stage: d.stage,
        useCase: d.useCase,
        nextAction: d.nextAction,
        nextActionDue: d.dueInDays === null ? null : new Date(now + d.dueInDays * DAY),
        activities: { create: [{ userId: demo.id, kind: "note", body: "Demo entry — replace with your own research." }] },
      },
    });
  }
  if ((await prisma.post.count({ where: { authorId: demo.id } })) === 0) {
    const tag = async (slugs: string[]) =>
      (await prisma.organization.findMany({ where: { slug: { in: slugs } }, select: { id: true } })).map((o) => ({ orgId: o.id }));
    await prisma.post.create({
      data: { authorId: demo.id, body: "This week: mapping peso stablecoin rails. Who's the right person at $bitso for MXNB settlement pilots?", orgs: { create: await tag(["bitso"]) } },
    });
    await prisma.post.create({
      data: { authorId: demo.id, body: "Esta semana: preparando un memo bilingüe sobre SPEI + stablecoins. ¿Quién más está en $fintech-mexico?", orgs: { create: await tag(["fintech-mexico"]) } },
    });
  }
  console.log("Seeded demo user (demo@corridor.local) with a demo pipeline.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
