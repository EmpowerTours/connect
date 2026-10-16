import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "@/lib/env";

const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@postgres.railway.internal:5432/railway",
  AUTH_SESSION_SECRET: "x".repeat(48),
  NEXT_PUBLIC_RP_ID: "empowertours.xyz",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "t",
  ADMIN_WALLETS: "0x1111111111111111111111111111111111111111",
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  S3_BUCKET: "connect-media",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
};

const errorsFor = (env: Record<string, string | undefined>) => checkProductionEnv(env).errors.map((e) => e.split(":")[0]);

describe("checkProductionEnv", () => {
  it("accepts a complete Railway + R2 configuration", () => {
    expect(checkProductionEnv(GOOD).errors).toEqual([]);
  });

  it("accepts local storage on an absolute volume path", () => {
    const env = { ...GOOD, STORAGE_DRIVER: "local", UPLOADS_DIR: "/data/uploads" };
    expect(checkProductionEnv(env).errors).toEqual([]);
    expect(errorsFor({ ...env, UPLOADS_DIR: undefined })).toContain("UPLOADS_DIR");
    expect(errorsFor({ ...env, UPLOADS_DIR: "uploads" })).toContain("UPLOADS_DIR");
  });

  it("names every missing or unsafe value", () => {
    expect(errorsFor({ NODE_ENV: "production" })).toEqual(
      expect.arrayContaining(["DATABASE_URL", "AUTH_SESSION_SECRET", "NEXT_PUBLIC_RP_ID", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "ADMIN_WALLETS", "UPLOADS_DIR"]),
    );
    expect(errorsFor({ ...GOOD, DATABASE_URL: "file:./dev.db" })).toEqual(["DATABASE_URL"]);
    expect(errorsFor({ ...GOOD, AUTH_SESSION_SECRET: "short" })).toEqual(["AUTH_SESSION_SECRET"]);
    expect(errorsFor({ ...GOOD, NEXT_PUBLIC_RP_ID: "connect.empowertours.xyz" })).toEqual(["NEXT_PUBLIC_RP_ID"]);
    expect(errorsFor({ ...GOOD, ADMIN_WALLETS: "not-an-address" })).toEqual(["ADMIN_WALLETS"]);
    expect(errorsFor({ ...GOOD, S3_BUCKET: undefined })).toEqual(["STORAGE_DRIVER=s3"]);
    expect(errorsFor({ ...GOOD, STORAGE_DRIVER: "gcs" })).toEqual(["STORAGE_DRIVER"]);
    expect(errorsFor({ ...GOOD, ALLOW_DEV_LOGIN: "1" })).toEqual(["ALLOW_DEV_LOGIN"]);
  });

  it("checks the RP ID the bundle was built with, not only the runtime value", () => {
    expect(checkProductionEnv(GOOD, { rpId: "empowertours.xyz" }).errors).toEqual([]);
    expect(checkProductionEnv(GOOD, { rpId: undefined }).errors.map((e) => e.split(":")[0])).toEqual(["NEXT_PUBLIC_RP_ID (build)"]);
  });

  it("never echoes values in messages", () => {
    const secret = "super-secret-value-that-must-not-appear";
    const { errors, warnings } = checkProductionEnv({ ...GOOD, AUTH_SESSION_SECRET: "s", UPSTASH_REDIS_REST_URL: secret, CRON_SECRET: "short" });
    expect([...errors, ...warnings].join("\n")).not.toContain(secret);
    expect(warnings.join("\n")).toContain("CRON_SECRET");
  });
});
