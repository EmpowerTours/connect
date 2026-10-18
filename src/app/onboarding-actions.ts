"use server";

import { limitMember } from "@/lib/rate-limit-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canClaim, validateOrgRequest } from "@/lib/claims";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { isPlaceholderHandle, isPlaceholderName, normalizeHandle, suggestHandle, validateHandle } from "@/lib/handles";
import { toList } from "@/lib/json";
import { resolveOrgChoice, validateBasics, validateFocus, validateLinks } from "@/lib/onboarding";
import { validateOpportunity } from "@/lib/opportunities";
import { getBlobStore, newAvatarKey } from "@/lib/storage";
import { processAvatar } from "@/lib/uploads";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const step = (s: string, error?: string) => `/welcome?step=${s}${error ? `&error=${error}` : ""}`;

/** Step 1: name + headline (+ handle). */
export async function saveBasicsAction(fd: FormData) {
  const user = await requireUser();
  const r = validateBasics({ name: str(fd, "name"), headline: str(fd, "headline") });
  if (!r.ok) redirect(step("you", r.error));
  if (isPlaceholderName(r.value.name)) redirect(step("you", "name_empty"));
  const h = await chooseHandle(user, str(fd, "handle"), r.value.name);
  if (!h.ok) redirect(step("you", h.error));
  try {
    await prisma.user.update({ where: { id: user.id }, data: { name: r.value.name, handle: h.handle, headline: r.value.headline, role: r.value.headline } });
  } catch (e) {
    if (isUniqueViolation(e)) redirect(step("you", "handle_taken"));
    throw e;
  }
  redirect(step("org"));
}

/**
 * The handle for step 1: the one the member typed (validated, must be free), else the current one,
 * except that a placeholder (new_member, from a sign-up without a name) is replaced by one built
 * from the name.
 */
async function chooseHandle(user: { id: string; handle: string }, raw: string, name: string): Promise<{ ok: true; handle: string } | { ok: false; error: string }> {
  const typed = normalizeHandle(raw);
  if (typed && typed !== user.handle) {
    const v = validateHandle(typed);
    if (!v.ok) return v;
    const clash = await prisma.user.findFirst({ where: { handle: v.value, NOT: { id: user.id } }, select: { id: true } });
    return clash ? { ok: false, error: "handle_taken" } : { ok: true, handle: v.value };
  }
  if (!isPlaceholderHandle(user.handle)) return { ok: true, handle: user.handle };
  const taken = new Set((await prisma.user.findMany({ where: { NOT: { id: user.id } }, select: { handle: true } })).map((u) => u.handle));
  return { ok: true, handle: suggestHandle(name, taken) ?? user.handle };
}

/** Step 2: pick an existing org (optionally claim membership) or request a new one. */
export async function saveOrgAction(fd: FormData) {
  const user = await requireUser();
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } });
  const choice = resolveOrgChoice(str(fd, "org"), orgs);
  if (choice.kind === "existing") {
    await prisma.user.update({ where: { id: user.id }, data: { orgId: choice.orgId, orgName: choice.name } });
    if (fd.get("claim") === "on") {
      const existing = await prisma.orgClaim.findUnique({ where: { userId_orgId: { userId: user.id, orgId: choice.orgId } } });
      if (canClaim(user, existing).ok) {
        await prisma.orgClaim.upsert({
          where: { userId_orgId: { userId: user.id, orgId: choice.orgId } },
          create: { userId: user.id, orgId: choice.orgId, title: user.headline },
          update: { status: "pending", title: user.headline, decidedAt: null, decidedBy: null },
        });
      }
    }
  } else if (choice.kind === "new") {
    const r = validateOrgRequest({ name: choice.name, website: str(fd, "website"), type: str(fd, "type") }, orgs);
    if (!r.ok) redirect(step("org", `org_${r.error}`));
    await prisma.user.update({ where: { id: user.id }, data: { orgId: null, orgName: r.value.name } });
    const dup = await prisma.orgRequest.findFirst({ where: { userId: user.id, name: r.value.name, status: "pending" } });
    if (!dup) await prisma.orgRequest.create({ data: { userId: user.id, name: r.value.name, website: r.value.website, type: r.value.type } });
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { orgId: null, orgName: "" } });
  }
  redirect(step("focus"));
}

/** Step 3: region + focus tags. */
export async function saveFocusAction(fd: FormData) {
  const user = await requireUser();
  const back = str(fd, "back") === "profile";
  const r = validateFocus({ region: str(fd, "region"), tags: fd.getAll("tags").map(String) });
  if (!r.ok) redirect(back ? `/profile?error=${r.error}#focus` : step("focus", r.error));
  await prisma.user.update({ where: { id: user.id }, data: { region: r.value.region, focusTags: toList(r.value.tags) } });
  if (back) {
    revalidatePath("/", "layout");
    redirect("/profile?saved=1#focus");
  }
  redirect(step("profile"));
}

/** Store a new profile photo for `userId`; returns an error code or null. */
async function storeAvatar(userId: string, oldKey: string | null, file: File): Promise<string | null> {
  const out = await processAvatar(new Uint8Array(await file.arrayBuffer()));
  if (!out.ok) return out.error;
  const store = getBlobStore();
  const key = newAvatarKey();
  await store.put(key, out.data, out.contentType);
  await prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });
  if (oldKey) await store.delete(oldKey);
  return null;
}

/** Step 4 (and Edit profile): optional photo + links. Finishes the profile part of onboarding. */
export async function saveProfileExtrasAction(fd: FormData) {
  const user = await requireUser();
  const back = str(fd, "back") === "profile" ? "/profile" : null;
  const fail = (e: string) => redirect(back ? `${back}?error=${e}#photo` : step("profile", e));
  const links = validateLinks({ x: str(fd, "x"), linkedin: str(fd, "linkedin"), website: str(fd, "website") });
  if (!links.ok) fail(`link_${links.error}`);
  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!(await limitMember(user.id, "upload")).ok) fail("photo_rate_limited");
    const err = await storeAvatar(user.id, user.avatarKey, photo);
    if (err) fail(`photo_${err}`);
  }
  if (links.ok) {
    await prisma.user.update({ where: { id: user.id }, data: { ...links.value, onboardedAt: user.onboardedAt ?? new Date() } });
  }
  revalidatePath("/", "layout");
  redirect(back ? `${back}?saved=1#photo` : step("first"));
}

export async function removePhotoAction() {
  const user = await requireUser();
  if (user.avatarKey) {
    await prisma.user.update({ where: { id: user.id }, data: { avatarKey: null } });
    await getBlobStore().delete(user.avatarKey);
  }
  revalidatePath("/", "layout");
}

/** Step 5: first ask/offer (or skip). */
export async function firstOpportunityAction(fd: FormData) {
  const user = await requireUser();
  const now = new Date();
  if (!user.onboardedAt) await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: now } });
  if (fd.get("skip") === "1") redirect("/?welcome=1");
  const r = validateOpportunity({ kind: str(fd, "kind"), headline: str(fd, "headline"), body: str(fd, "body"), region: user.region, topic: str(fd, "topic") });
  if (!r.ok) redirect(step("first", r.error));
  await prisma.opportunity.create({ data: { ...r.value, orgName: user.orgName, orgId: user.orgId, authorId: user.id } });
  revalidatePath("/opportunities");
  redirect("/?welcome=1");
}
