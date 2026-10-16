import "server-only";
import { prisma } from "../db";
import { handlesFor } from "./public";
import { ZERO_ADDRESS } from "./typed-data";

/** Display helpers: wallet -> handle, "org:<slug>" -> organization name. */
export async function graphLabels(items: { subject: string; object: string; author?: string; ref: string }[]) {
  const wallets = items.flatMap((i) => [i.subject, i.object, i.author ?? ""]).filter((w) => w && w !== ZERO_ADDRESS);
  const slugs = [...new Set(items.map((i) => i.ref).filter((r) => r.startsWith("org:")).map((r) => r.slice(4)))];
  const [names, orgs] = await Promise.all([
    handlesFor(wallets),
    slugs.length ? prisma.organization.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } }) : Promise.resolve([]),
  ]);
  const orgNames = new Map(orgs.map((o) => [o.slug, o.name]));
  return {
    party: (w: string) => (w && w !== ZERO_ADDRESS ? { wallet: w, handle: names.get(w)?.handle ?? null } : null),
    org: (ref: string) => (ref.startsWith("org:") ? (orgNames.get(ref.slice(4)) ?? ref.slice(4)) : null),
  };
}
