/**
 * LOCAL DEV ONLY: fictional demo people, their updates, intros, asks/offers
 * and a demo pipeline, on top of the base seed. Every person is flagged
 * isDemo and shown with a Demo badge.
 *
 *   npm run seed:demo
 *
 * Refuses to run when NODE_ENV=production.
 */
import { PrismaClient } from "@prisma/client";
import { demoSeedAllowed, seedBase } from "./seed-base";
import { seedSocial } from "./seed-social";

const prisma = new PrismaClient();
const DAY = 86_400_000;

async function main() {
  if (!demoSeedAllowed()) {
    console.error("seed:demo refuses to run with NODE_ENV=production (it creates fictional people).");
    process.exit(1);
  }
  await seedBase(prisma);
  // Demo user + demo pipeline. These are YOUR pipeline entries (stages, tasks),
  // not claims about the institutions. No contacts or competing chains are invented.
  const demo = await prisma.user.upsert({
    where: { email: "demo@corridor.local" },
    update: {},
    create: {
      email: "demo@corridor.local",
      name: "Alex Rivera",
      isDemo: true,
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
  await seedSocial(prisma);
  console.log("Seeded demo user (demo@corridor.local) with a demo pipeline.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
