/**
 * `npm run db:check`: fail if prisma/schema.prisma has changes that no migration covers.
 * Replays prisma/migrations into a scratch shadow database on the local PostgreSQL
 * (scripts/lib/local-postgres.ts) and diffs it against the schema. Never touches DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import { ensureDatabase, startLocalPostgres } from "./lib/local-postgres";

async function main() {
  const { pg, stop } = await startLocalPostgres();
  try {
    const shadow = await ensureDatabase(pg, "connect_shadow_check");
    const r = spawnSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "prisma/schema.prisma", "--shadow-database-url", shadow, "--exit-code"],
      { encoding: "utf8" },
    );
    process.stdout.write(r.stdout);
    if (r.status === 0) console.log("Migrations match the schema.");
    else {
      process.stderr.write(r.stderr);
      console.error("The schema has changes without a migration: run `npm run db:migrate -- --name <change>`.");
      process.exitCode = 1;
    }
  } finally {
    await stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
