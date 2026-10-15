import { PrismaClient } from "@prisma/client";
import { ingestAllFeeds } from "../src/lib/ingest";

const prisma = new PrismaClient();
ingestAllFeeds(prisma)
  .then((r) => {
    for (const f of r.feeds) console.log(`${f.name}: fetched ${f.fetched}, new ${f.created}${f.error ? ` (error: ${f.error})` : ""}`);
    console.log(`Total new signals: ${r.created}, tagged to orgs: ${r.tagged}`);
  })
  .finally(() => prisma.$disconnect());
