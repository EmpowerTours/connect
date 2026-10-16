/**
 * Railway Infrastructure as Code for Connect (replaces the deprecated railway.json; new services
 * cannot use Config as Code). Review with `railway config plan`, apply with `railway config apply`.
 * Nothing here holds a secret: secret values are set in the Railway dashboard and kept with preserve().
 *
 * `partial` scopes this file to the resources it declares, so applying it inside a project that
 * already has other EmpowerTours services never touches them.
 */
import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export const partial = "connect";

export default defineRailway((ctx) => {
  const db = postgres("connect-postgres");

  const web = service("connect", {
    source: github("EmpowerTours/connect", { branch: "main" }),
    // Dockerfile build (detected automatically). The start script runs `prisma migrate deploy`
    // and then the standalone Next server; a failed migration stops the deploy. A start command
    // replaces the image ENTRYPOINT, so tini (signal forwarding, zombie reaping) is named here.
    start: "/usr/bin/tini -- node start.mjs",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: ctx.environment === "production" ? [{ domain: "connect.empowertours.xyz", port: 3000 }] : [],
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      PORT: "3000",
      NEXT_PUBLIC_RP_ID: "empowertours.xyz",
      STORAGE_DRIVER: "s3",
      S3_REGION: "auto",
      AUTH_SESSION_SECRET: preserve(),
      UPSTASH_REDIS_REST_URL: preserve(),
      UPSTASH_REDIS_REST_TOKEN: preserve(),
      ADMIN_WALLETS: preserve(),
      S3_ENDPOINT: preserve(),
      S3_BUCKET: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
    },
  });

  return project("connect", { resources: [db, web] });
});
