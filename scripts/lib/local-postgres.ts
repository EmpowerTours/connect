/**
 * A real PostgreSQL 17 for local development and scripts, without Docker or a system install:
 * the `embedded-postgres` dev dependency ships the server binaries. Data lives in
 * .data/postgres (gitignored). Local only: fixed local credentials, bound to 127.0.0.1.
 *
 * Production uses Railway Postgres through DATABASE_URL and never touches this file.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export const LOCAL_PG = {
  port: Number(process.env.LOCAL_PG_PORT ?? 54329),
  user: "connect",
  password: "connect-local-only",
  dir: path.join(process.cwd(), ".data", "postgres"),
};

export function localDatabaseUrl(database = "connect"): string {
  return `postgresql://${LOCAL_PG.user}:${LOCAL_PG.password}@127.0.0.1:${LOCAL_PG.port}/${database}`;
}

async function isUp(): Promise<boolean> {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port: LOCAL_PG.port });
    s.once("connect", () => (s.end(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

/**
 * Start the local cluster if it is not already running (another terminal may own it).
 * Returns a stop() that only stops a cluster this call started.
 */
export async function startLocalPostgres(): Promise<{ pg: EmbeddedPostgres; started: boolean; stop: () => Promise<void> }> {
  const pg = new EmbeddedPostgres({
    databaseDir: LOCAL_PG.dir,
    user: LOCAL_PG.user,
    password: LOCAL_PG.password,
    port: LOCAL_PG.port,
    persistent: true,
    onLog: () => {},
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
  });
  if (await isUp()) return { pg, started: false, stop: async () => {} };
  if (!existsSync(path.join(LOCAL_PG.dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  return { pg, started: true, stop: () => pg.stop() };
}

/** Create a database if it does not exist yet (CREATE DATABASE has no IF NOT EXISTS). */
export async function ensureDatabase(pg: EmbeddedPostgres, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`bad database name: ${name}`);
  const client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
  return localDatabaseUrl(name);
}
