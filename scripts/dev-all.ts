/**
 * `npm run dev:all`: one command from a fresh clone to a running app.
 *
 *   1. creates .env from .env.example if there is no .env yet
 *   2. starts the embedded PostgreSQL (scripts/lib/local-postgres.ts, data in .data/postgres)
 *      and creates the `connect` database
 *   3. applies the committed migrations (prisma migrate deploy) and the base seed
 *   4. on a fresh database, adds the fictional demo network (skip with `-- --no-demo`)
 *   5. runs `next dev` on http://localhost:3000 and stops Postgres again on Ctrl+C
 *
 * No Docker, no system Postgres, no accounts. Uses DATABASE_URL from the environment when it is
 * set there explicitly; otherwise the local database. Never use this against production.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ensureDatabase, startLocalPostgres } from "./lib/local-postgres";

const args = new Set(process.argv.slice(2));
const withDemo = !args.has("--no-demo");
const setupOnly = args.has("--setup-only");

function run(cmd: string, cmdArgs: string[], env: NodeJS.ProcessEnv): void {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", env });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} failed (exit ${String(r.status)})`);
}

async function main() {
  if (!existsSync(".env") && existsSync(".env.example")) {
    copyFileSync(".env.example", ".env");
    console.log("Created .env from .env.example");
  }

  const { pg, started, stop } = await startLocalPostgres();
  let stopping = false;
  const shutdown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    if (started) {
      console.log("Stopping local PostgreSQL…");
      await stop().catch(() => {});
    }
    process.exit(code);
  };

  try {
    const localUrl = await ensureDatabase(pg, "connect");
    console.log(`${started ? "Started" : "Reusing running"} local PostgreSQL on 127.0.0.1`);
    // An explicit DATABASE_URL in the shell wins (Prisma and Next never override set variables).
    const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || localUrl };

    run("npx", ["prisma", "migrate", "deploy"], env);
    run("npx", ["tsx", "prisma/seed.ts"], env);

    if (withDemo) {
      const client = pg.getPgClient("connect", "127.0.0.1");
      await client.connect();
      let fresh = true;
      try {
        const { rowCount } = await client.query(`SELECT 1 FROM "User" WHERE handle = 'demo'`);
        fresh = !rowCount;
      } finally {
        await client.end();
      }
      if (fresh) run("npx", ["tsx", "prisma/seed-demo.ts"], env);
      else console.log("Demo data already present; leaving it as is (npm run seed:demo resets it).");
    }

    if (setupOnly) {
      console.log("Database ready.");
      return shutdown(0);
    }

    console.log("\nStarting Next.js on http://localhost:3000 (Ctrl+C stops the app and the database)\n");
    // Run the Next CLI directly (not through npx) so signals reach it. embedded-postgres stops the
    // database on SIGINT/SIGTERM itself; the exit hook makes sure the dev server goes down with it.
    const next = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "dev"], { stdio: "inherit", env });
    const stopNext = () => {
      if (next.exitCode === null && next.signalCode === null) next.kill("SIGTERM");
    };
    process.on("SIGINT", stopNext);
    process.on("SIGTERM", stopNext);
    process.on("exit", stopNext);
    next.on("exit", (code) => void shutdown(code ?? 0));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    await shutdown(1);
  }
}

void main();
