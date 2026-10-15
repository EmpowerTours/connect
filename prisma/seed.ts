/**
 * Default / production seed: real organizations, public news feeds and topic
 * channels only. No people. Demo people: `npm run seed:demo` (local dev only).
 */
import { PrismaClient } from "@prisma/client";
import { seedBase } from "./seed-base";

const prisma = new PrismaClient();

async function main() {
  const n = await seedBase(prisma);
  console.log(`Seeded ${n.orgs} organizations, ${n.feeds} RSS feeds and ${n.channels} channels. No people (demo: npm run seed:demo).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
