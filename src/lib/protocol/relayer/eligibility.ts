/**
 * Why an account may get sponsored gas (design section 6): an invite link or a one-time phone or
 * email check, stored in ProtocolSponsorship. Takes the Prisma client so the relayer service and
 * the web app share it.
 */
import type { PrismaClient } from "@prisma/client";
import type { Eligibility } from "./policy";

type Db = Pick<PrismaClient, "protocolSponsorship">;

/** Null = no sponsorship; the member submits from a wallet of their own. */
export async function sponsorEligibility(db: Db, userId: string): Promise<Eligibility | null> {
  const row = await db.protocolSponsorship.findUnique({ where: { userId } });
  if (!row) return null;
  if (row.source === "invite" && row.inviterId) return { source: "invite", inviterId: row.inviterId };
  if (row.source === "verified") return { source: "verified" };
  return null;
}

/**
 * Records a grant. The first grant wins and is never overwritten, so an invite can't later be
 * swapped for a different inviter. Call from the invite signup path (PR #6) and from the
 * phone/email check once it exists.
 */
export async function grantSponsorship(db: Db, userId: string, grant: Eligibility): Promise<void> {
  await db.protocolSponsorship.upsert({
    where: { userId },
    create: { userId, source: grant.source, inviterId: grant.source === "invite" ? grant.inviterId : null },
    update: {},
  });
}
