"use server";

import { limitMember } from "@/lib/rate-limit-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { areConnected } from "@/lib/intros";
import {
  DEFAULT_EXPIRY_DAYS,
  applyOpportunityAction,
  validateDirectIntro,
  validateOpportunity,
  validateReport,
  type OpportunityAction,
} from "@/lib/opportunities";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const withParam = (url: string, k: string, v: string) => `${url}${url.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
const DAY = 24 * 60 * 60 * 1000;

/** Loads an opportunity and checks the signed-in member may apply `action` to it. */
async function ownedOpportunity(id: string, action: OpportunityAction) {
  const user = await requireUser();
  const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
  const r = applyOpportunityAction(opp, action, user.id);
  if (!r.ok) redirect(`/opportunities/${id}?error=${r.error}`);
  return { user, opp, status: r.status };
}

function revalidateOpps(id?: string) {
  revalidatePath("/opportunities");
  if (id) revalidatePath(`/opportunities/${id}`);
  revalidatePath("/");
}

export async function createOpportunityAction(fd: FormData) {
  const user = await requireUser();
  const backRaw = str(fd, "back");
  const back = backRaw.startsWith("/opportunities") ? backRaw : "/opportunities";
  const r = validateOpportunity({
    kind: str(fd, "kind"),
    headline: str(fd, "headline"),
    body: str(fd, "body"),
    region: str(fd, "region"),
    topic: str(fd, "topic"),
    expiresInDays: str(fd, "expiresIn"),
  });
  if (!r.ok) redirect(withParam(withParam(back, "new", "1"), "error", r.error));
  const orgName = str(fd, "orgName").slice(0, 80) || user.orgName;
  const opp = await prisma.opportunity.create({
    data: { ...r.value, orgName, orgId: orgName === user.orgName ? (user.orgId ?? null) : null, authorId: user.id },
  });
  revalidateOpps();
  redirect(`/opportunities/${opp.id}?posted=1`);
}

export async function updateOpportunityAction(fd: FormData) {
  const id = str(fd, "id");
  const { opp } = await ownedOpportunity(id, "edit");
  const keep = str(fd, "expiresIn") === "keep";
  const r = validateOpportunity({
    kind: str(fd, "kind"),
    headline: str(fd, "headline"),
    body: str(fd, "body"),
    region: str(fd, "region"),
    topic: str(fd, "topic"),
    expiresInDays: keep ? DEFAULT_EXPIRY_DAYS : str(fd, "expiresIn"),
  });
  if (!r.ok) redirect(`/opportunities/${id}?edit=1&error=${r.error}`);
  await prisma.opportunity.update({ where: { id }, data: { ...r.value, expiresAt: keep ? opp.expiresAt : r.value.expiresAt } });
  revalidateOpps(id);
  redirect(`/opportunities/${id}?saved=1`);
}

/** Mark filled, close, or reopen (reopening starts a fresh default expiry). */
export async function setOpportunityStatusAction(fd: FormData) {
  const id = str(fd, "id");
  const raw = str(fd, "action");
  const action: OpportunityAction = raw === "fill" || raw === "close" || raw === "reopen" ? raw : "close";
  const { status } = await ownedOpportunity(id, action);
  const now = new Date();
  await prisma.opportunity.update({
    where: { id },
    data:
      action === "reopen"
        ? { status, closedAt: null, expiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * DAY) }
        : { status, closedAt: now },
  });
  revalidateOpps(id);
  redirect(`/opportunities/${id}`);
}

/** "Request intro" on someone's ask/offer when there is no mutual connector: goes straight to the author. */
export async function requestDirectIntroAction(fd: FormData) {
  const user = await requireUser();
  const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: str(fd, "opportunityId") } });
  if (!(await limitMember(user.id, "intro", "introDaily")).ok) redirect(`/opportunities/${opp.id}?introError=rate_limited#intro`);
  const reason = str(fd, "reason");
  const [edges, existing] = await Promise.all([
    prisma.followUser.findMany({
      where: { OR: [{ followerId: { in: [user.id, opp.authorId] } }, { followeeId: { in: [user.id, opp.authorId] } }] },
      select: { followerId: true, followeeId: true },
    }),
    prisma.intro.findMany({ where: { requesterId: user.id, targetId: opp.authorId }, select: { status: true, opportunityId: true } }),
  ]);
  const err = validateDirectIntro({ requesterId: user.id, opportunity: opp, reason, alreadyConnected: areConnected(edges, user.id, opp.authorId), existing });
  if (err) redirect(`/opportunities/${opp.id}?introError=${err}#intro`);
  await prisma.intro.create({
    data: {
      mode: "direct",
      opportunityId: opp.id,
      requesterId: user.id,
      connectorId: opp.authorId,
      targetId: opp.authorId,
      reason: reason.slice(0, 300),
      message: reason.slice(0, 300),
      status: "pending",
    },
  });
  revalidatePath("/", "layout");
  redirect(`/opportunities/${opp.id}?requested=1#intro`);
}

export async function reportOpportunityAction(fd: FormData) {
  const user = await requireUser();
  const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: str(fd, "id") } });
  if (!(await limitMember(user.id, "report")).ok) redirect(`/opportunities/${opp.id}?reportError=rate_limited#report`);
  const r = validateReport({ reporterId: user.id, authorId: opp.authorId, reason: str(fd, "reason"), note: str(fd, "note") });
  if (!r.ok) redirect(`/opportunities/${opp.id}?reportError=${r.error}#report`);
  const key = { reporterId_targetType_targetId: { reporterId: user.id, targetType: "opportunity", targetId: opp.id } };
  // One report per member per post; a repeat report updates the reason but keeps a decided report decided.
  await prisma.report.upsert({
    where: key,
    create: { reporterId: user.id, targetType: "opportunity", targetId: opp.id, ...r.value },
    update: { ...r.value },
  });
  revalidatePath("/admin");
  redirect(`/opportunities/${opp.id}?reported=1`);
}
