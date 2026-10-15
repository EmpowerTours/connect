"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { devLoginAllowed, isValidEmail } from "@/lib/auth-core";
import { LANG_COOKIE, createSession, destroySession, ensureUser, getCurrentUser, getWorkspace, issueMagicLink, requireUser } from "@/lib/auth";
import { ADVISOR_INFLUENCE, ACTIVITY_KINDS, ORG_TYPES, POST_MAX_LENGTH, regionForCountry } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import { ingestAllFeeds } from "@/lib/ingest";
import { parseList, toList } from "@/lib/json";
import { canTransition, isStage } from "@/lib/pipeline";
import { getScoutProvider } from "@/lib/scout";
import { slugify } from "@/lib/slug";
import { extractCashtags, matchOrgs } from "@/lib/tagging";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/* ---------- auth ---------- */

export async function requestMagicLinkAction(fd: FormData) {
  const email = str(fd, "email");
  if (!isValidEmail(email)) redirect("/login?error=email");
  const t = await issueMagicLink(email);
  // Local MVP: no email provider. The link is logged and shown on the page.
  console.log(`[magic-link] ${email}: /auth/verify?token=${t}`);
  redirect(`/login?sent=${encodeURIComponent(t)}`);
}

export async function devLoginAction() {
  if (!devLoginAllowed()) redirect("/login?error=dev");
  const user = await ensureUser("demo@corridor.local");
  await createSession(user.id);
  redirect("/pipeline");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function setLocaleAction(fd: FormData) {
  const locale = str(fd, "locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LANG_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
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
    locale: str(fd, "locale") || "en",
  });
  const clash = await prisma.user.findFirst({ where: { handle: data.handle, NOT: { id: user.id } } });
  if (clash) redirect("/profile?error=handle");
  const org = data.orgName ? await prisma.organization.findFirst({ where: { name: data.orgName } }) : null;
  await prisma.user.update({ where: { id: user.id }, data: { ...data, orgId: org?.id ?? null } });
  revalidatePath("/", "layout");
  redirect("/profile?saved=1");
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
    console.error("[scout]", err);
    redirect(`/orgs/${org.slug}?scoutError=1`);
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

export async function createPostAction(fd: FormData) {
  const user = await requireUser();
  const body = str(fd, "body");
  if (!body || body.length > POST_MAX_LENGTH) redirect("/feed?error=post");
  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true, name: true, aliases: true } });
  const tagged = new Set(extractCashtags(body));
  const ids = new Set(orgs.filter((o) => tagged.has(o.slug)).map((o) => o.id));
  for (const o of matchOrgs(body, orgs)) ids.add(o.id);
  await prisma.post.create({ data: { authorId: user.id, body, orgs: { create: [...ids].map((orgId) => ({ orgId })) } } });
  revalidatePath("/feed");
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
  revalidatePath("/feed");
}

export async function ingestNowAction() {
  await requireUser();
  await ingestAllFeeds(prisma);
  revalidatePath("/feed");
}
