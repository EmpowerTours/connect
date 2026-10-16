"use server";

import { limitMember } from "@/lib/rate-limit-server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { devLoginAllowed } from "@/lib/auth-core";
import { DEMO_EMAIL, LANG_COOKIE, createDemoSession, destroySession, ensureUser, getCurrentUser, getWorkspace, requireAdmin, requireUser } from "@/lib/auth";
import { ADVISOR_INFLUENCE, ACTIVITY_KINDS, ORG_TYPES, regionForCountry } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/error-report";
import { isLocale } from "@/lib/i18n";
import { ingestAllFeeds } from "@/lib/ingest";
import { parseList, toList } from "@/lib/json";
import { canTransition, isStage } from "@/lib/pipeline";
import { getScoutProvider } from "@/lib/scout";
import { slugify } from "@/lib/slug";
import { extractCashtags, matchOrgs } from "@/lib/tagging";
import { applyIntroAction, validateIntroRequest, type IntroAction } from "@/lib/intros";
import { extractMentions, isPostKind, threadIdsFor, validatePostBody } from "@/lib/posts";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/* ---------- auth ---------- */

// Sign-in is Mera passkey only (see /api/auth/* and src/lib/mera). Email
// magic links were removed with the move to Mera wallets.

/** LOCAL DEMO ONLY: one-click login as the seeded demo user, no wallet.
 *  Refused unless devLoginAllowed() (non-production, or ALLOW_DEV_LOGIN=1). */
export async function devLoginAction() {
  if (!devLoginAllowed()) redirect("/login?error=dev");
  const user = await ensureUser(DEMO_EMAIL);
  await createDemoSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function setLocaleAction(fd: FormData) {
  const locale = str(fd, "locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LANG_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  const user = await getCurrentUser();
  if (user) await prisma.user.update({ where: { id: user.id }, data: { locale } });
  revalidatePath("/", "layout");
}

/* ---------- profile & follows ---------- */

const profileSchema = z.object({
  name: z.string().min(1).max(80),
  handle: z.string().regex(/^[a-z0-9_]{2,24}$/),
  role: z.string().max(80),
  orgName: z.string().max(80),
  bio: z.string().max(400),
  voice: z.string().max(400),
  location: z.string().max(80),
  locale: z.enum(["en", "es"]),
});

export async function updateProfileAction(fd: FormData) {
  const user = await requireUser();
  const data = profileSchema.parse({
    name: str(fd, "name"),
    handle: str(fd, "handle").toLowerCase(),
    role: str(fd, "role"),
    orgName: str(fd, "orgName"),
    bio: str(fd, "bio"),
    voice: str(fd, "voice"),
    location: str(fd, "location"),
    locale: str(fd, "locale") || "en",
  });
  const clash = await prisma.user.findFirst({ where: { handle: data.handle, NOT: { id: user.id } } });
  if (clash) redirect("/profile?error=handle");
  const org = data.orgName ? await prisma.organization.findFirst({ where: { name: data.orgName } }) : null;
  await prisma.user.update({ where: { id: user.id }, data: { ...data, headline: data.role, orgId: org?.id ?? null } });
  revalidatePath("/", "layout");
  redirect(`/u/${data.handle}?saved=1`);
}

export async function toggleFollowOrgAction(fd: FormData) {
  const user = await requireUser();
  const orgId = str(fd, "orgId");
  const key = { userId_orgId: { userId: user.id, orgId } };
  const existing = await prisma.followOrg.findUnique({ where: key });
  if (existing) await prisma.followOrg.delete({ where: key });
  else await prisma.followOrg.create({ data: { userId: user.id, orgId } });
  revalidatePath("/", "layout");
}

export async function toggleFollowUserAction(fd: FormData) {
  const user = await requireUser();
  const followeeId = str(fd, "userId");
  if (followeeId === user.id) return;
  const key = { followerId_followeeId: { followerId: user.id, followeeId } };
  const existing = await prisma.followUser.findUnique({ where: key });
  if (existing) await prisma.followUser.delete({ where: key });
  else await prisma.followUser.create({ data: { followerId: user.id, followeeId } });
  revalidatePath("/", "layout");
}

/* ---------- organizations ---------- */

export async function createOrgAction(fd: FormData) {
  await requireUser();
  const name = str(fd, "name");
  const type = str(fd, "type");
  if (!name || !(ORG_TYPES as readonly string[]).includes(type)) redirect("/directory?error=org");
  let slug = slugify(name) || "org";
  if (await prisma.organization.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  const country = str(fd, "country").toUpperCase().slice(0, 2);
  await prisma.organization.create({
    data: { slug, name, type, country, region: regionForCountry(country), website: str(fd, "website") },
  });
  redirect(`/orgs/${slug}`);
}

export async function updateOrgAction(fd: FormData) {
  await requireUser();
  const id = str(fd, "orgId");
  const type = str(fd, "type");
  const country = str(fd, "country").toUpperCase().slice(0, 2);
  const org = await prisma.organization.update({
    where: { id },
    data: {
      ...((ORG_TYPES as readonly string[]).includes(type) ? { type } : {}),
      country,
      region: regionForCountry(country),
      website: str(fd, "website"),
      aliases: toList(str(fd, "aliases")),
      chainsInUse: toList(str(fd, "chainsInUse")),
      chainsEvaluating: toList(str(fd, "chainsEvaluating")),
      notes: str(fd, "notes").slice(0, 4000),
    },
  });
  revalidatePath(`/orgs/${org.slug}`);
}

/* ---------- pipeline ---------- */

async function ownedDeal(dealId: string) {
  const user = await requireUser();
  const ws = await getWorkspace(user.id);
  const deal = await prisma.deal.findFirst({ where: { id: dealId, workspaceId: ws.id }, include: { org: true } });
  if (!deal) throw new Error("Deal not found");
  return { user, deal };
}

export async function addToPipelineAction(fd: FormData) {
  const user = await requireUser();
  const ws = await getWorkspace(user.id);
  const orgId = str(fd, "orgId");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  await prisma.deal.upsert({
    where: { workspaceId_orgId: { workspaceId: ws.id, orgId } },
    update: {},
    create: {
      workspaceId: ws.id,
      orgId,
      activities: { create: { userId: user.id, kind: "stage_change", body: "Added to pipeline → awareness" } },
    },
  });
  revalidatePath(`/orgs/${org.slug}`);
  revalidatePath("/pipeline");
  redirect(`/orgs/${org.slug}?tab=deal`);
}

export async function moveDealAction(dealId: string, to: string): Promise<{ ok: boolean; error?: string }> {
  const { user, deal } = await ownedDeal(dealId);
  if (!isStage(to) || !isStage(deal.stage)) return { ok: false, error: "Unknown stage" };
  if (!canTransition(deal.stage, to)) return { ok: false, error: `Can't jump from ${deal.stage} to ${to} — move one stage at a time.` };
  await prisma.deal.update({
    where: { id: deal.id },
    data: { stage: to, activities: { create: { userId: user.id, kind: "stage_change", body: `${deal.stage} → ${to}` } } },
  });
  revalidatePath("/pipeline");
  revalidatePath(`/orgs/${deal.org.slug}`);
  return { ok: true };
}

export async function moveDealFormAction(fd: FormData) {
  await moveDealAction(str(fd, "dealId"), str(fd, "stage"));
}

export async function updateDealAction(fd: FormData) {
  const { deal } = await ownedDeal(str(fd, "dealId"));
  const due = str(fd, "nextActionDue");
  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      useCase: str(fd, "useCase").slice(0, 200),
      nextAction: str(fd, "nextAction").slice(0, 200),
      nextActionDue: due ? new Date(`${due}T12:00:00`) : null,
      competingChains: toList(str(fd, "competingChains")),
      lostReason: str(fd, "lostReason").slice(0, 300),
    },
  });
  revalidatePath(`/orgs/${deal.org.slug}`);
  revalidatePath("/pipeline");
}

export async function addContactAction(fd: FormData) {
  const { deal } = await ownedDeal(str(fd, "dealId"));
  const name = str(fd, "name");
  if (!name) return;
  await prisma.contact.create({
    data: { dealId: deal.id, name, title: str(fd, "title"), email: str(fd, "email"), isChampion: fd.get("isChampion") === "on" },
  });
  revalidatePath(`/orgs/${deal.org.slug}`);
}

export async function removeContactAction(fd: FormData) {
  const { deal } = await ownedDeal(str(fd, "dealId"));
  await prisma.contact.deleteMany({ where: { id: str(fd, "id"), dealId: deal.id } });
  revalidatePath(`/orgs/${deal.org.slug}`);
}

export async function addAdvisorAction(fd: FormData) {
  const { deal } = await ownedDeal(str(fd, "dealId"));
  const name = str(fd, "name");
  if (!name) return;
  const firm = str(fd, "firm");
  const influence = (ADVISOR_INFLUENCE as readonly string[]).includes(str(fd, "influence")) ? str(fd, "influence") : "medium";
  const advisorOrg = firm ? await prisma.organization.findFirst({ where: { name: firm } }) : null;
  await prisma.advisor.create({
    data: { dealId: deal.id, name, firm, influence, notes: str(fd, "notes"), advisorOrgId: advisorOrg?.id ?? null },
  });
  revalidatePath(`/orgs/${deal.org.slug}`);
}

export async function removeAdvisorAction(fd: FormData) {
  const { deal } = await ownedDeal(str(fd, "dealId"));
  await prisma.advisor.deleteMany({ where: { id: str(fd, "id"), dealId: deal.id } });
  revalidatePath(`/orgs/${deal.org.slug}`);
}

export async function logActivityAction(fd: FormData) {
  const { user, deal } = await ownedDeal(str(fd, "dealId"));
  const body = str(fd, "body");
  const kind = (ACTIVITY_KINDS as readonly string[]).includes(str(fd, "kind")) ? str(fd, "kind") : "note";
  if (!body) return;
  await prisma.activity.create({ data: { dealId: deal.id, userId: user.id, kind, body: body.slice(0, 2000) } });
  await prisma.deal.update({ where: { id: deal.id }, data: { updatedAt: new Date() } });
  revalidatePath(`/orgs/${deal.org.slug}`);
  revalidatePath("/pipeline");
}

/* ---------- AI scout ---------- */

export async function generateScoutAction(fd: FormData) {
  const user = await requireUser();
  const ws = await getWorkspace(user.id);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: str(fd, "orgId") } });
  const locale = str(fd, "locale") === "es" ? "es" : "en";
  const deal = await prisma.deal.findUnique({
    where: { workspaceId_orgId: { workspaceId: ws.id, orgId: org.id } },
    include: { contacts: true },
  });
  const signals = await prisma.signal.findMany({
    where: { orgs: { some: { orgId: org.id } } },
    orderBy: { publishedAt: "desc" },
    take: 3,
  });
  const provider = getScoutProvider();
  let result;
  try {
    result = await provider.generate({
      locale,
      org: {
        name: org.name,
        type: org.type,
        country: org.country,
        region: org.region,
        website: org.website,
        chainsInUse: parseList(org.chainsInUse),
        chainsEvaluating: parseList(org.chainsEvaluating),
        notes: org.notes,
      },
      deal: deal
        ? {
            stage: deal.stage,
            useCase: deal.useCase,
            competingChains: parseList(deal.competingChains),
            contacts: deal.contacts.map((c) => ({ name: c.name, title: c.title, isChampion: c.isChampion })),
          }
        : undefined,
      sender: { name: user.name, role: user.role, orgName: user.orgName, voice: user.voice },
      signals: signals.map((s) => ({ title: s.title, url: s.url })),
    });
  } catch (err) {
    await reportError("scout draft failed", err, { scope: "scout", orgId: org.id });
    redirect(`/orgs/${org.slug}?tab=deal&scoutError=1`);
  }
  await prisma.scoutDraft.create({
    data: {
      orgId: org.id,
      userId: user.id,
      provider: result.provider,
      locale,
      fit: result.fit,
      angles: JSON.stringify(result.angles),
      subject: result.subject,
      draft: result.draft,
    },
  });
  if (deal) {
    await prisma.activity.create({ data: { dealId: deal.id, userId: user.id, kind: "scout", body: `AI scout draft generated (${result.provider})` } });
  }
  revalidatePath(`/orgs/${org.slug}`);
}

/* ---------- feed ---------- */

export async function createPostAction(fd: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!(await limitMember(user.id, "post", "postDaily")).ok) return { ok: false, error: "rate_limited" };
  const v = validatePostBody(String(fd.get("body") ?? ""));
  if (!v.ok) return { ok: false, error: v.error };
  const body = v.body;
  const kindRaw = str(fd, "kind");
  const parentId = str(fd, "parentId") || null;
  const quoteOfId = str(fd, "quoteOfId") || null;
  const parent = parentId ? await prisma.post.findUnique({ where: { id: parentId }, select: { id: true, rootId: true, channelId: true } }) : null;
  if (parentId && !parent) return { ok: false, error: "parent_missing" };
  if (quoteOfId && !(await prisma.post.findUnique({ where: { id: quoteOfId }, select: { id: true } }))) return { ok: false, error: "quote_missing" };
  const channel = !parent && str(fd, "channel") ? await prisma.channel.findUnique({ where: { slug: str(fd, "channel") } }) : null;

  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true, name: true, aliases: true } });
  const tagged = new Set(extractCashtags(body));
  const orgIds = new Set(orgs.filter((o) => tagged.has(o.slug)).map((o) => o.id));
  for (const o of matchOrgs(body, orgs)) orgIds.add(o.id);
  const handles = extractMentions(body);
  const mentioned = handles.length ? await prisma.user.findMany({ where: { handle: { in: handles } }, select: { id: true } }) : [];
  const { rootId } = threadIdsFor(parent ? { id: parent.id, rootId: parent.rootId } : null);

  const post = await prisma.post.create({
    data: {
      authorId: user.id,
      body,
      kind: !parent && isPostKind(kindRaw) ? kindRaw : "",
      parentId: parent?.id ?? null,
      rootId,
      quoteOfId,
      channelId: channel?.id ?? null,
      orgs: { create: [...orgIds].map((orgId) => ({ orgId })) },
      mentions: { create: mentioned.map((m) => ({ userId: m.id })) },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, id: post.id };
}

export async function toggleLikeAction(postId: string) {
  const user = await requireUser();
  const key = { userId_postId: { userId: user.id, postId } };
  if (await prisma.like.findUnique({ where: key })) await prisma.like.delete({ where: key });
  else await prisma.like.create({ data: { userId: user.id, postId } });
  revalidatePath("/", "layout");
}

export async function toggleRecastAction(postId: string) {
  const user = await requireUser();
  const key = { userId_postId: { userId: user.id, postId } };
  if (await prisma.recast.findUnique({ where: key })) await prisma.recast.delete({ where: key });
  else await prisma.recast.create({ data: { userId: user.id, postId } });
  revalidatePath("/", "layout");
}

export async function toggleChannelAction(fd: FormData) {
  const user = await requireUser();
  const channelId = str(fd, "channelId");
  const key = { userId_channelId: { userId: user.id, channelId } };
  if (await prisma.channelMember.findUnique({ where: key })) await prisma.channelMember.delete({ where: key });
  else await prisma.channelMember.create({ data: { userId: user.id, channelId } });
  revalidatePath("/", "layout");
}

/* ---------- warm intros ---------- */

export async function draftIntroAction(fd: FormData) {
  const user = await requireUser();
  const target = await prisma.user.findUniqueOrThrow({ where: { id: str(fd, "targetId") } });
  const connectorId = str(fd, "connectorId");
  const reason = str(fd, "reason").slice(0, 300);
  const locale = str(fd, "locale") === "es" ? "es" : "en";
  const back = `/u/${target.handle}?intro=1`;
  if (!(await limitMember(user.id, "intro", "introDaily")).ok) redirect(`${back}&error=rate_limited`);
  const edges = await prisma.followUser.findMany({ select: { followerId: true, followeeId: true } });
  const open = await prisma.intro.findMany({ where: { requesterId: user.id, targetId: target.id }, select: { requesterId: true, targetId: true, status: true } });
  const err = validateIntroRequest({ requesterId: user.id, connectorId, targetId: target.id }, edges, open);
  if (err) redirect(`${back}&error=${encodeURIComponent(err)}`);
  const connector = await prisma.user.findUniqueOrThrow({ where: { id: connectorId } });
  const [mine, theirs] = await Promise.all([
    prisma.postOrg.findMany({ where: { post: { authorId: user.id } }, select: { org: { select: { name: true } } } }),
    prisma.postOrg.findMany({ where: { post: { authorId: target.id } }, select: { org: { select: { name: true } } } }),
  ]);
  const theirOrgs = new Set(theirs.map((x) => x.org.name));
  const sharedTopics = [...new Set(mine.map((x) => x.org.name).filter((n) => theirOrgs.has(n)))];
  let draft;
  try {
    draft = await getScoutProvider().draftIntro({
      locale,
      requester: { name: user.name, headline: user.headline || user.role, orgName: user.orgName, voice: user.voice },
      connector: { name: connector.name },
      target: { name: target.name, headline: target.headline, orgName: target.orgName },
      reason,
      sharedTopics,
    });
  } catch (e) {
    await reportError("intro draft failed", e, { scope: "intro" });
    redirect(`${back}&error=${encodeURIComponent("AI draft failed — check provider settings.")}`);
  }
  // Replace an existing unsent draft for this target instead of piling up drafts.
  await prisma.intro.deleteMany({ where: { requesterId: user.id, targetId: target.id, status: "draft" } });
  const intro = await prisma.intro.create({
    data: { requesterId: user.id, connectorId, targetId: target.id, reason, message: draft.message, provider: draft.provider, status: "draft" },
  });
  redirect(`/u/${target.handle}?intro=${intro.id}`);
}

async function transitionIntro(id: string, action: IntroAction, data: { message?: string; connectorNote?: string } = {}) {
  const user = await requireUser();
  const intro = await prisma.intro.findUniqueOrThrow({ where: { id } });
  const res = applyIntroAction(intro, action, user.id);
  if (!res.ok) throw new Error(res.error);
  await prisma.intro.update({
    where: { id },
    data: {
      status: res.status,
      ...(data.message !== undefined ? { message: data.message.slice(0, 2000) } : {}),
      ...(data.connectorNote !== undefined ? { connectorNote: data.connectorNote.slice(0, 1000) } : {}),
      ...(action === "accept" || action === "decline" ? { respondedAt: new Date() } : {}),
    },
  });
  revalidatePath("/", "layout");
  return intro;
}

export async function sendIntroAction(fd: FormData) {
  await transitionIntro(str(fd, "introId"), "send", { message: str(fd, "message") });
  redirect("/intros?tab=sent");
}

export async function respondIntroAction(fd: FormData) {
  const action = str(fd, "decision") === "accept" ? "accept" : "decline";
  const intro = await transitionIntro(str(fd, "introId"), action, { connectorNote: str(fd, "note") });
  // A direct request accepted by the author connects the two members (mutual follow).
  if (action === "accept" && intro.mode === "direct") {
    const a = intro.requesterId;
    const b = intro.targetId;
    await prisma.$transaction([
      prisma.followUser.upsert({ where: { followerId_followeeId: { followerId: a, followeeId: b } }, create: { followerId: a, followeeId: b }, update: {} }),
      prisma.followUser.upsert({ where: { followerId_followeeId: { followerId: b, followeeId: a } }, create: { followerId: b, followeeId: a }, update: {} }),
    ]);
    revalidatePath("/", "layout");
  }
}

export async function withdrawIntroAction(fd: FormData) {
  await transitionIntro(str(fd, "introId"), "withdraw");
}

export async function addSignalAction(fd: FormData) {
  const user = await requireUser();
  const title = str(fd, "title");
  if (!title) return;
  const url = str(fd, "url") || null;
  const summary = str(fd, "summary");
  if (url && (await prisma.signal.findUnique({ where: { url } }))) return;
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, aliases: true } });
  const matches = matchOrgs(`${title}\n${summary}`, orgs);
  await prisma.signal.create({
    data: {
      source: "manual",
      sourceName: user.name,
      title,
      url,
      summary,
      createdById: user.id,
      orgs: { create: matches.map((o) => ({ orgId: o.id })) },
    },
  });
  revalidatePath("/signals");
}

/** Admins only: refresh the public news feeds now (they also refresh lazily, see ingest-schedule.ts). */
export async function ingestNowAction() {
  await requireAdmin();
  await ingestAllFeeds(prisma);
  revalidatePath("/", "layout");
}
