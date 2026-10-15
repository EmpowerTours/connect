import { ORG_TYPES } from "./constants";
import { normalizeWebUrl } from "./links";
import { slugify } from "./slug";

export const CLAIM_STATUSES = ["pending", "approved", "rejected", "withdrawn", "revoked"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type ClaimAction = "approve" | "reject" | "withdraw" | "revoke";

export type ClaimEligibility = { ok: true } | { ok: false; error: "wallet_required" | "already_pending" | "already_member" };

/** Only passkey-verified users can claim, once per org (a rejected or withdrawn claim can be re-filed). */
export function canClaim(
  user: { walletVerified: boolean; walletAddress: string | null },
  existing: { status: string } | null | undefined,
): ClaimEligibility {
  if (!user.walletVerified || !user.walletAddress) return { ok: false, error: "wallet_required" };
  if (existing?.status === "pending") return { ok: false, error: "already_pending" };
  if (existing?.status === "approved") return { ok: false, error: "already_member" };
  return { ok: true };
}

/**
 *   pending  --approve(admin)-->  approved
 *   pending  --reject(admin)-->   rejected
 *   pending  --withdraw(owner)--> withdrawn
 *   approved --revoke(admin)-->   revoked
 */
export function applyClaimAction(
  claim: { status: string; userId: string },
  action: ClaimAction,
  actor: { userId: string; isAdmin: boolean },
): { ok: true; status: ClaimStatus } | { ok: false; error: string } {
  switch (action) {
    case "approve":
    case "reject":
      if (!actor.isAdmin) return { ok: false, error: "admin only" };
      if (claim.status !== "pending") return { ok: false, error: `can't ${action} a ${claim.status} claim` };
      return { ok: true, status: action === "approve" ? "approved" : "rejected" };
    case "withdraw":
      if (actor.userId !== claim.userId) return { ok: false, error: "only the claimant can withdraw" };
      if (claim.status !== "pending") return { ok: false, error: `can't withdraw a ${claim.status} claim` };
      return { ok: true, status: "withdrawn" };
    case "revoke":
      if (!actor.isAdmin) return { ok: false, error: "admin only" };
      if (claim.status !== "approved") return { ok: false, error: `can't revoke a ${claim.status} claim` };
      return { ok: true, status: "revoked" };
  }
}

export type ClaimInputError = "title_long" | "evidence_url" | "note_long";

export function validateClaimInput(input: { title: string; evidenceUrl: string; note: string }):
  | { ok: true; value: { title: string; evidenceUrl: string; note: string } }
  | { ok: false; error: ClaimInputError } {
  const title = input.title.trim().replace(/\s+/g, " ");
  const note = input.note.trim();
  if ([...title].length > 100) return { ok: false, error: "title_long" };
  if ([...note].length > 500) return { ok: false, error: "note_long" };
  const url = normalizeWebUrl(input.evidenceUrl);
  if (!url.ok) return { ok: false, error: "evidence_url" };
  return { ok: true, value: { title, evidenceUrl: url.value, note } };
}

export type OrgRequestError = "name_empty" | "name_long" | "website" | "type" | "exists";

/** A request to add a missing organization. Rejects names that already exist (by slug or name). */
export function validateOrgRequest(
  input: { name: string; website: string; type: string },
  existing: { slug: string; name: string }[],
): { ok: true; value: { name: string; website: string; type: string; slug: string } } | { ok: false; error: OrgRequestError } {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "name_empty" };
  if ([...name].length > 80) return { ok: false, error: "name_long" };
  if (input.type && !(ORG_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: "type" };
  const site = normalizeWebUrl(input.website);
  if (!site.ok) return { ok: false, error: "website" };
  const slug = slugify(name);
  if (!slug) return { ok: false, error: "name_empty" };
  if (existing.some((o) => o.slug === slug || o.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "exists" };
  return { ok: true, value: { name, website: site.value, type: input.type || "fintech", slug } };
}
