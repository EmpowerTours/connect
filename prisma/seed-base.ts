/**
 * The default (and production) seed: public, factual reference data only.
 *
 *   - the 53 real organizations in seed-data.ts (public facts, no people)
 *   - the public RSS/Atom news feeds that produce Signals (`npm run ingest`)
 *   - topic channels (Stablecoins, Payments, ...)
 *
 * It creates NO users, posts, asks/offers or intros. Fictional demo people live
 * behind `npm run seed:demo` (prisma/seed-demo.ts), which refuses to run in
 * production. tests/seed.test.ts enforces both.
 */
import type { PrismaClient } from "@prisma/client";
import { regionForCountry } from "../src/lib/constants";
import { toList } from "../src/lib/json";
import { DEFAULT_FEEDS } from "../src/lib/rss";
import { slugify } from "../src/lib/slug";
import { SEED_ORGS } from "./seed-data";

export const CHANNELS = [
  { slug: "stablecoins", name: "Stablecoins", description: "Issuance, rails, reserves and regulation." },
  { slug: "tokenization", name: "Tokenization", description: "Tokenized deposits, funds and securities." },
  { slug: "rwa", name: "RWA", description: "Real-world assets onchain: issuers, transfer agents, distribution." },
  { slug: "latam-payments", name: "LatAm payments", description: "SPEI, PIX, remittance corridors and on/off-ramps." },
  { slug: "custody", name: "Custody", description: "Qualified custody, MPC, staking and ops." },
  { slug: "monad", name: "Monad", description: "Building and partnering in the Monad ecosystem." },
  { slug: "market-structure", name: "Market structure", description: "Exchanges, clearing, settlement and market infra." },
  { slug: "bd-craft", name: "BD craft", description: "Playbooks, outreach, procurement and closing institutional deals." },
];

/** The only models the base seed may touch. */
export type BaseSeedDb = Pick<PrismaClient, "organization" | "rssFeed" | "channel">;

export async function seedBase(db: BaseSeedDb) {
  for (const o of SEED_ORGS) {
    const data = {
      name: o.name,
      type: o.type,
      country: o.country,
      region: regionForCountry(o.country),
      website: o.website,
      aliases: toList(o.aliases ?? []),
      chainsInUse: toList(o.chainsInUse ?? []),
      notes: o.notes ?? "",
    };
    await db.organization.upsert({ where: { slug: slugify(o.name) }, update: data, create: { slug: slugify(o.name), ...data } });
  }
  for (const f of DEFAULT_FEEDS) await db.rssFeed.upsert({ where: { url: f.url }, update: { name: f.name }, create: f });
  for (const c of CHANNELS) await db.channel.upsert({ where: { slug: c.slug }, update: c, create: c });
  return { orgs: SEED_ORGS.length, feeds: DEFAULT_FEEDS.length, channels: CHANNELS.length };
}

/**
 * seed:demo creates fictional people; never in production. Besides NODE_ENV, refuse anything
 * that looks hosted (a Railway environment, or a database that is not on this machine), so a
 * `railway run npm run seed:demo` or a copied production DATABASE_URL cannot fill the real network.
 */
export function demoSeedAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID) return false;
  const url = env.DATABASE_URL;
  if (url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return url.startsWith("file:");
    }
    if (url.startsWith("file:")) return true;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return false;
  }
  return true;
}
