"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { currentUserIsAdmin, requireAdmin, requireUser } from "@/lib/auth";
import {
  applyClaimAction,
  canClaim,
  canEditOrgRequest,
  planOrgApproval,
  validateClaimInput,
  validateOrgRequest,
  type ClaimAction,
  type OrgApprovalPlan,
} from "@/lib/claims";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { deleteStoredImage, hasFile, storeUploadedImage } from "@/lib/image-store";
import { limitMember } from "@/lib/rate-limit-server";
import { slugify } from "@/lib/slug";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const safeBack = (raw: string, fallback: string) => (raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback);
const withParam = (url: string, k: string, v: string) => `${url}${url.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;

/* ---------- member side ---------- */

export async function claimOrgAction(fd: FormData) {
  const user = await requireUser();
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: str(fd, "orgId") } });
  const back = safeBack(str(fd, "back"), `/orgs/${org.slug}?tab=people`);
  const existing = await prisma.orgClaim.findUnique({ where: { userId_orgId: { userId: user.id, orgId: org.id } } });
  const can = canClaim(user, existing);
  if (!can.ok) redirect(withParam(back, "claimError", can.error));
  const input = validateClaimInput({ title: str(fd, "title"), evidenceUrl: str(fd, "evidenceUrl"), note: str(fd, "note") });
  if (!input.ok) redirect(withParam(back, "claimError", input.error));
  await prisma.orgClaim.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    create: { userId: user.id, orgId: org.id, ...input.value },
    update: { ...input.value, status: "pending", decidedAt: null, decidedBy: null, decisionNote: "" },
  });
  revalidatePath(`/orgs/${org.slug}`);
  redirect(withParam(back, "claim", "sent"));
}

export async function withdrawClaimAction(fd: FormData) {
  const user = await requireUser();
  const claim = await prisma.orgClaim.findUniqueOrThrow({ where: { id: str(fd, "claimId") }, include: { org: true } });
  const r = applyClaimAction(claim, "withdraw", { userId: user.id, isAdmin: false });
  if (!r.ok) throw new Error(r.error);
  await prisma.orgClaim.update({ where: { id: claim.id }, data: { status: r.status } });
  revalidatePath(`/orgs/${claim.org.slug}`);
}

/** "Add organization" (Organizations page): a request an admin reviews, with an optional logo. */
export async function requestOrgAction(fd: FormData) {
  const user = await requireUser();
  const back = safeBack(str(fd, "back"), "/orgs");
  const fail = (e: string, extra = ""): never => redirect(`${withParam(back, "orgError", e)}${extra}#add-org`);
  const existing = await prisma.organization.findMany({ select: { slug: true, name: true } });
  const r = validateOrgRequest({ name: str(fd, "name"), website: str(fd, "website"), type: str(fd, "type") }, existing);
  if (!r.ok) {
    const hit = r.error === "exists" ? existing.find((o) => o.slug === slugify(str(fd, "name")) || o.name.toLowerCase() === str(fd, "name").toLowerCase()) : undefined;
    return fail(r.error, hit ? `&orgSlug=${encodeURIComponent(hit.slug)}` : "");
  }
  let logoKey: string | undefined;
  if (hasFile(fd, "photo")) {
    if (!(await limitMember(user.id, "upload")).ok) return fail("photo_rate_limited");
    const img = await storeUploadedImage(fd.get("photo") as File);
    if (!img.ok) return fail(`photo_${img.error}`);
    logoKey = img.key;
  }
  const fields = { website: r.value.website, type: r.value.type, note: str(fd, "note").slice(0, 500) };
  const dup = await prisma.orgRequest.findFirst({ where: { userId: user.id, name: r.value.name, status: "pending" } });
  if (dup) {
    // Sending the same request again updates it (new details, new logo) instead of stacking copies.
    await prisma.orgRequest.update({ where: { id: dup.id }, data: { ...fields, ...(logoKey ? { logoKey } : {}) } });
    if (logoKey) await deleteStoredImage(dup.logoKey);
  } else {
    await prisma.orgRequest.create({ data: { userId: user.id, name: r.value.name, ...fields, logoKey: logoKey ?? null } });
  }
  revalidatePath("/orgs");
  revalidatePath("/admin");
  redirect(`${withParam(back, "orgRequested", "1")}#my-requests`);
}

/** Edit your own pending organization request: name, website, type, note and logo. */
export async function updateOrgRequestAction(fd: FormData) {
  const user = await requireUser();
  const fail = (e: string): never => redirect(`/orgs?reqError=${e}#my-requests`);
  const req = await prisma.orgRequest.findUnique({ where: { id: str(fd, "requestId") } });
  if (!req) return fail("not_found");
  const can = canEditOrgRequest(req, user.id);
  if (!can.ok) return fail(can.error);
  const existing = await prisma.organization.findMany({ select: { slug: true, name: true } });
  const r = validateOrgRequest({ name: str(fd, "name"), website: str(fd, "website"), type: str(fd, "type") }, existing);
  if (!r.ok) return fail(r.error);
  let logoKey = req.logoKey;
  if (hasFile(fd, "photo")) {
    if (!(await limitMember(user.id, "upload")).ok) return fail("photo_rate_limited");
    const img = await storeUploadedImage(fd.get("photo") as File);
    if (!img.ok) return fail(`photo_${img.error}`);
    logoKey = img.key;
  } else if (fd.get("removeLogo") === "on") {
    logoKey = null;
  }
  // Re-checked in the write itself so an admin decision in between is not overwritten.
  const res = await prisma.orgRequest.updateMany({
    where: { id: req.id, userId: user.id, status: "pending" },
    data: { name: r.value.name, website: r.value.website, type: r.value.type, note: str(fd, "note").slice(0, 500), logoKey },
  });
  if (res.count === 0) {
    if (logoKey !== req.logoKey) await deleteStoredImage(logoKey);
    return fail("not_pending");
  }
  if (logoKey !== req.logoKey) await deleteStoredImage(req.logoKey);
  revalidatePath("/orgs");
  revalidatePath("/admin");
  redirect("/orgs?reqSaved=1#my-requests");
}

/** Change an organization's logo: admins, and members whose claim to work there was approved. */
export async function updateOrgLogoAction(fd: FormData) {
  const user = await requireUser();
  const org = await prisma.organization.findUnique({ where: { id: str(fd, "orgId") } });
  if (!org) return redirect("/orgs");
  const back = `/orgs/${org.slug}?tab=about`;
  const fail = (e: string): never => redirect(`${back}&logoError=${e}#logo`);
  const member = await prisma.orgClaim.findFirst({ where: { orgId: org.id, userId: user.id, status: "approved" }, select: { id: true } });
  if (!member && !(await currentUserIsAdmin())) return fail("not_allowed");
  let logoKey: string | null = org.logoKey;
  if (hasFile(fd, "photo")) {
    if (!(await limitMember(user.id, "upload")).ok) return fail("photo_rate_limited");
    const img = await storeUploadedImage(fd.get("photo") as File);
    if (!img.ok) return fail(`photo_${img.error}`);
    logoKey = img.key;
  } else if (fd.get("removeLogo") === "on") {
    logoKey = null;
  } else {
    return fail("photo_empty");
  }
  await prisma.organization.update({ where: { id: org.id }, data: { logoKey } });
  if (logoKey !== org.logoKey) await deleteStoredImage(org.logoKey);
  revalidatePath("/", "layout");
  redirect(`${back}&logoSaved=1#logo`);
}

/* ---------- admin side ---------- */

export async function adminDecideClaimAction(fd: FormData) {
  const admin = await requireAdmin();
  const action = str(fd, "decision") as ClaimAction;
  if (!["approve", "reject", "revoke"].includes(action)) throw new Error("bad decision");
  const claim = await prisma.orgClaim.findUniqueOrThrow({ where: { id: str(fd, "claimId") }, include: { user: true, org: true } });
  const r = applyClaimAction(claim, action, { userId: admin.id, isAdmin: true });
  if (!r.ok) throw new Error(r.error);
  await prisma.$transaction(async (tx) => {
    await tx.orgClaim.update({
      where: { id: claim.id },
      data: { status: r.status, decidedAt: new Date(), decidedBy: admin.walletAddress, decisionNote: str(fd, "note").slice(0, 300) },
    });
    if (r.status === "approved" && (!claim.user.orgId || claim.user.orgId === claim.orgId)) {
      await tx.user.update({ where: { id: claim.userId }, data: { orgId: claim.orgId, orgName: claim.org.name } });
    }
    if (r.status === "revoked" && claim.user.orgId === claim.orgId) {
      await tx.user.update({ where: { id: claim.userId }, data: { orgId: null } });
    }
  });
  revalidatePath("/admin");
  revalidatePath(`/orgs/${claim.org.slug}`);
}

export async function adminDecideOrgRequestAction(fd: FormData) {
  const admin = await requireAdmin();
  const decision = str(fd, "decision");
  const done = (d: string): never => redirect(`/admin?tab=orgs&${d}`);
  if (decision !== "approve" && decision !== "reject") return done("error=bad_decision");
  const req = await prisma.orgRequest.findUnique({ where: { id: str(fd, "requestId") }, include: { user: true } });
  if (!req) return done("error=not_found");
  // A second tap, or another admin got there first: nothing to do, and no error page.
  if (req.status !== "pending") return done(`done=already_${req.status}`);
  const decided = { decidedAt: new Date(), decidedBy: admin.walletAddress };
  if (decision === "reject") {
    await prisma.orgRequest.updateMany({ where: { id: req.id, status: "pending" }, data: { status: "rejected", ...decided } });
    revalidatePath("/admin");
    return done("done=rejected");
  }
  const existing = await prisma.organization.findMany({ select: { id: true, slug: true, name: true } });
  const plan = planOrgApproval(req, existing);
  if (plan.kind === "invalid") return done(`error=${plan.error}`);
  let linked = plan.kind === "link";
  let slug = "";
  try {
    slug = await approveOrgRequest(req, plan, decided);
  } catch (e) {
    // The org was added between the read above and the insert (unique slug): link to it instead.
    if (!isUniqueViolation(e) || plan.kind !== "create") throw e;
    const now = await prisma.organization.findMany({ select: { id: true, slug: true, name: true } });
    const retry = planOrgApproval(req, now);
    if (retry.kind !== "link") throw e;
    slug = await approveOrgRequest(req, retry, decided);
    linked = true;
  }
  revalidatePath("/admin");
  revalidatePath("/orgs");
  if (slug) revalidatePath(`/orgs/${slug}`);
  return done(linked ? "done=linked" : "done=approved");
}

type RequestWithUser = Prisma.OrgRequestGetPayload<{ include: { user: true } }>;

/** Creates the org (or links the existing one), closes the request, and opens the requester's membership claim. Returns the org slug. */
async function approveOrgRequest(req: RequestWithUser, plan: Exclude<OrgApprovalPlan, { kind: "invalid" }>, decided: { decidedAt: Date; decidedBy: string | null }): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const org =
      plan.kind === "create"
        ? await tx.organization.create({
            data: {
              slug: plan.value.slug,
              name: plan.value.name,
              website: plan.value.website,
              type: plan.value.type,
              logoKey: req.logoKey,
              notes: "Added at a member's request; details not yet reviewed.",
            },
          })
        : await tx.organization.findUniqueOrThrow({ where: { id: plan.orgId } });
    // An existing org keeps its own logo and website; the request only fills what is missing.
    if (plan.kind === "link" && ((!org.logoKey && req.logoKey) || (!org.website && req.website))) {
      await tx.organization.update({
        where: { id: org.id },
        data: { ...(!org.logoKey && req.logoKey ? { logoKey: req.logoKey } : {}), ...(!org.website && req.website ? { website: req.website } : {}) },
      });
    }
    const closed = await tx.orgRequest.updateMany({ where: { id: req.id, status: "pending" }, data: { status: "approved", orgId: org.id, ...decided } });
    if (closed.count === 0) throw new Error("request was decided concurrently");
    // The requester usually works there: open a pending membership claim for review, unless they already have one.
    if (req.user.walletVerified) {
      const claim = await tx.orgClaim.findUnique({ where: { userId_orgId: { userId: req.userId, orgId: org.id } }, select: { id: true } });
      if (!claim) await tx.orgClaim.create({ data: { userId: req.userId, orgId: org.id, note: "Opened automatically from the organization request." } });
    }
    return org.slug;
  });
}
