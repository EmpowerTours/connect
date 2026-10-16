/**
 * Production entrypoint inside the Docker image (Railway start command: `node start.mjs`).
 *   1. `prisma migrate deploy` (applies committed migrations; never resets or pushes).
 *   2. Optional base seed (real orgs, feeds, channels; never people) when SEED_ON_BOOT=1.
 *      Leave it off after the first deploy: the seed upserts org rows and would undo admin edits.
 *   3. Starts the standalone Next server in this process.
 * Boot-time configuration checks run inside the server (src/instrumentation.ts).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prismaCli = process.env.PRISMA_CLI ?? path.join(here, "prisma-cli", "node_modules", "prisma", "build", "index.js");
const schema = path.join(here, "prisma", "schema.prisma");

function run(label, args) {
  console.log(`[start] ${label}`);
  // The CLI is a short-lived child; give it a small heap so it does not compete with the server.
  const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=192", PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`[start] ${label} failed (exit ${r.status ?? r.signal}); not starting the server.`);
    process.exit(r.status || 1);
  }
}

if (process.env.SKIP_MIGRATIONS !== "1") {
  if (!existsSync(prismaCli)) {
    console.error(`[start] Prisma CLI not found at ${prismaCli}`);
    process.exit(1);
  }
  run("prisma migrate deploy", [prismaCli, "migrate", "deploy", "--schema", schema]);
}

if (process.env.SEED_ON_BOOT === "1") run("base seed (orgs, feeds, channels)", [path.join(here, "seed.cjs")]);

process.env.HOSTNAME ??= "0.0.0.0";
await import(path.join(here, "server.js"));
