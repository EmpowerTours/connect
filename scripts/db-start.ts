/**
 * `npm run db:start`: run the local PostgreSQL (see scripts/lib/local-postgres.ts) in this
 * terminal until Ctrl+C, with the `connect` database created. Then, in another terminal:
 *   DATABASE_URL=<printed url> npm run db:migrate && npm run db:seed && npm run dev
 * (or put that DATABASE_URL in your .env).
 */
import { ensureDatabase, startLocalPostgres } from "./lib/local-postgres";

async function main() {
  const { pg, started, stop } = await startLocalPostgres();
  const url = await ensureDatabase(pg, "connect");
  console.log(`${started ? "Started" : "Already running:"} local PostgreSQL`);
  console.log(`DATABASE_URL=${url}`);
  if (!started) return;
  console.log("Ctrl+C to stop.");
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
