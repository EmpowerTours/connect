/**
 * Production configuration check, run once at server start (src/instrumentation.ts).
 * A misconfigured deploy refuses to boot, so Railway keeps the previous healthy one.
 * Only names and reasons are reported, never values.
 */
import { EMPOWERTOURS_RP_ID } from "./mera/derive";
import { adminWallets } from "./admin";
import { s3ConfigFromEnv } from "./storage";

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

export function checkProductionEnv(env: Env, built: { rpId?: string } = {}): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const need = (name: string, ok: boolean, why: string) => {
    if (!ok) errors.push(`${name}: ${why}`);
  };

  const db = env.DATABASE_URL ?? "";
  need("DATABASE_URL", /^postgres(ql)?:\/\//.test(db), "must be a PostgreSQL URL (Railway: ${{Postgres.DATABASE_URL}})");

  need("AUTH_SESSION_SECRET", (env.AUTH_SESSION_SECRET ?? "").length >= 32, "must be at least 32 random characters");

  need(
    "NEXT_PUBLIC_RP_ID",
    env.NEXT_PUBLIC_RP_ID === EMPOWERTOURS_RP_ID,
    `must be exactly "${EMPOWERTOURS_RP_ID}" (shared passkey wallet across EmpowerTours apps); it is baked in at build time, so set it before building`,
  );

  // NEXT_PUBLIC_* values are inlined into the bundle at build time; the runtime value alone is not enough.
  if ("rpId" in built) {
    need("NEXT_PUBLIC_RP_ID (build)", built.rpId === EMPOWERTOURS_RP_ID, `this build was made without NEXT_PUBLIC_RP_ID="${EMPOWERTOURS_RP_ID}"; set the variable before the build and redeploy`);
  }

  need("UPSTASH_REDIS_REST_URL", /^https:\/\//.test(env.UPSTASH_REDIS_REST_URL ?? ""), "required: sign-in replay protection and rate limits are shared through Upstash Redis");
  need("UPSTASH_REDIS_REST_TOKEN", !!env.UPSTASH_REDIS_REST_TOKEN, "required with UPSTASH_REDIS_REST_URL");

  need("ADMIN_WALLETS", adminWallets(env).size > 0, "list at least one admin wallet address (0x...), comma separated");

  const driver = (env.STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver === "s3" || driver === "r2") {
    const cfg = s3ConfigFromEnv(env);
    if (!cfg.ok) errors.push(`STORAGE_DRIVER=${driver}: missing ${cfg.missing.join(", ")}`);
  } else if (driver === "local") {
    need("UPLOADS_DIR", !!env.UPLOADS_DIR && env.UPLOADS_DIR.startsWith("/"), "with STORAGE_DRIVER=local, set an absolute path on a mounted Railway volume (e.g. /data/uploads); the container disk is wiped on deploy. Or use STORAGE_DRIVER=s3 (R2)");
  } else {
    errors.push(`STORAGE_DRIVER: "${driver}" is not supported (local or s3)`);
  }

  need("ALLOW_DEV_LOGIN", !env.ALLOW_DEV_LOGIN, "must not be set in production (it enables the one-click demo login)");

  if (env.CRON_SECRET && env.CRON_SECRET.length < 32) warnings.push("CRON_SECRET is shorter than 32 characters, so /api/cron/ingest stays off");
  if (env.ANTHROPIC_API_KEY === undefined && env.OPENAI_API_KEY === undefined) warnings.push("no AI provider key: the scout uses its template drafts");
  return { errors, warnings };
}

/** Called at boot. Exits the process on errors in production. */
export function assertProductionEnv(env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  // Literal access so Next inlines the value the client bundle was built with.
  const { errors, warnings } = checkProductionEnv(env, { rpId: process.env.NEXT_PUBLIC_RP_ID });
  for (const w of warnings) console.warn(`[env] ${w}`);
  if (errors.length) {
    console.error(`[env] Refusing to start: ${errors.length} configuration problem(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
}
