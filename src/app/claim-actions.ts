"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { applyClaimAction, canClaim, validateClaimInput, validateOrgRequest, type ClaimAction } from "@/lib/claims";
import { prisma } from "@/lib/db";

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

export async function requestOrgAction(fd: FormData) {
  const user = await requireUser();
  const back = safeBack(str(fd, "back"), "/orgs");
  const existing = await prisma.organization.findMany({ select: { slug: true, name: true } });
  const r = validateOrgRequest({ name: str(fd, "name"), website: str(fd, "website"), type: str(fd, "type") }, existing);
  if (!r.ok) redirect(withParam(back, "orgError", r.error));
  const dup = await prisma.orgRequest.findFirst({ where: { userId: user.id, name: r.value.name, status: "pending" } });
  if (!dup) {
    await prisma.orgRequest.create({ data: { userId: user.id, name: r.value.name, website: r.value.website, type: r.value.type, note: str(fd, "note").slice(0, 500) } });
  }
  redirect(withParam(back, "orgRequested", "1"));
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
  const req = await prisma.orgRequest.findUniqueOrThrow({ where: { id: str(fd, "requestId") }, include: { user: true } });
  if (req.status !== "pending") throw new Error(`request is ${req.status}`);
  if (decision === "reject") {
    await prisma.orgRequest.update({ where: { id: req.id }, data: { status: "rejected", decidedAt: new Date(), decidedBy: admin.walletAddress } });
  } else if (decision === "approve") {
    const existing = await prisma.organization.findMany({ select: { slug: true, name: true } });
    const v = validateOrgRequest({ name: req.name, website: req.website, type: req.type }, existing);
    if (!v.ok) throw new Error(`can't approve: ${v.error}`);
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { slug: v.value.slug, name: v.value.name, website: v.value.website, type: v.value.type, notes: "Added at a member's request; details not yet reviewed." },
      });
      await tx.orgRequest.update({ where: { id: req.id }, data: { status: "approved", orgId: org.id, decidedAt: new Date(), decidedBy: admin.walletAddress } });
      // The requester usually works there: open a pending membership claim for review.
      if (req.user.walletVerified) {
        await tx.orgClaim.create({ data: { userId: req.userId, orgId: org.id, note: "Opened automatically from the organization request." } });
      }
    });
  } else {
    throw new Error("bad decision");
  }
  revalidatePath("/admin");
}
