"use server";

import { limitMember } from "@/lib/rate-limit-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canClaim, validateOrgRequest } from "@/lib/claims";
import { prisma } from "@/lib/db";
import { toList } from "@/lib/json";
import { pickPackIds } from "@/lib/curated-packs";
import { applyPacks } from "@/lib/curated-packs-db";
import { runFarcasterImport } from "@/lib/importers/farcaster-run";
import { confirmSuggestions } from "@/lib/importers/persist";
import { resolveOrgChoice, validateBasics, validateFocus, validateLinks } from "@/lib/onboarding";
import { getBlobStore, newAvatarKey } from "@/lib/storage";
import { processAvatar } from "@/lib/uploads";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const step = (s: string, error?: string) => `/welcome?step=${s}${error ? `&error=${error}` : ""}`;

type Member = Awaited<ReturnType<typeof requireUser>>;

/** The organization part of step 1: an existing org (optionally claim membership), a new one to request, or none. */
async function applyOrgChoice(user: Member, fd: FormData, headline: string): Promise<string | null> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } });
  const choice = resolveOrgChoice(str(fd, "org"), orgs);
  if (choice.kind === "existing") {
    await prisma.user.update({ where: { id: user.id }, data: { orgId: choice.orgId, orgName: choice.name } });
    if (fd.get("claim") === "on") {
      const existing = await prisma.orgClaim.findUnique({ where: { userId_orgId: { userId: user.id, orgId: choice.orgId } } });
      if (canClaim(user, existing).ok) {
        await prisma.orgClaim.upsert({
          where: { userId_orgId: { userId: user.id, orgId: choice.orgId } },
          create: { userId: user.id, orgId: choice.orgId, title: headline },
          update: { status: "pending", title: headline, decidedAt: null, decidedBy: null },
        });
      }
    }
  } else if (choice.kind === "new") {
    const r = validateOrgRequest({ name: choice.name, website: str(fd, "website"), type: str(fd, "type") }, orgs);
    if (!r.ok) return `org_${r.error}`;
    await prisma.user.update({ where: { id: user.id }, data: { orgId: null, orgName: r.value.name } });
    const dup = await prisma.orgRequest.findFirst({ where: { userId: user.id, name: r.value.name, status: "pending" } });
    if (!dup) await prisma.orgRequest.create({ data: { userId: user.id, name: r.value.name, website: r.value.website, type: r.value.type } });
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { orgId: null, orgName: "" } });
  }
  return null;
}

/** Step 1: name, headline and organization (pick one, claim membership, or request a new one). */
export async function saveBasicsAction(fd: FormData) {
  const user = await requireUser();
  const r = validateBasics({ name: str(fd, "name"), headline: str(fd, "headline") });
  if (!r.ok) redirect(step("you", r.error));
  await prisma.user.update({ where: { id: user.id }, data: { name: r.value.name, headline: r.value.headline, role: r.value.headline } });
  const orgError = await applyOrgChoice(user, fd, r.value.headline);
  if (orgError) redirect(step("you", orgError));
  redirect(step("focus"));
}

/** Step 2: region + focus tags (also the focus card on Edit profile). */
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
  redirect(step("follow"));
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

/** Edit profile: optional photo + links. */
export async function saveProfileExtrasAction(fd: FormData) {
  const user = await requireUser();
  const fail = (e: string) => redirect(`/profile?error=${e}#photo`);
  const links = validateLinks({ x: str(fd, "x"), linkedin: str(fd, "linkedin"), website: str(fd, "website") });
  if (!links.ok) fail(`link_${links.error}`);
  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!(await limitMember(user.id, "upload")).ok) fail("photo_rate_limited");
    const err = await storeAvatar(user.id, user.avatarKey, photo);
    if (err) fail(`photo_${err}`);
  }
  if (links.ok) await prisma.user.update({ where: { id: user.id }, data: links.value });
  revalidatePath("/", "layout");
  redirect("/profile?saved=1#photo");
}

export async function removePhotoAction() {
  const user = await requireUser();
  if (user.avatarKey) {
    await prisma.user.update({ where: { id: user.id }, data: { avatarKey: null } });
    await getBlobStore().delete(user.avatarKey);
  }
  revalidatePath("/", "layout");
}

/** Step 3: look up who the member follows on Farcaster; matches come back as suggestions on this step. */
export async function onboardingFarcasterAction(fd: FormData) {
  const user = await requireUser();
  const back = "/welcome?step=follow";
  if (!(await limitMember(user.id, "import")).ok) redirect(`${back}&fcError=rate_limited#farcaster`);
  const r = await runFarcasterImport(user, str(fd, "username"));
  if (!r.ok) redirect(`${back}&fcError=${r.error}#farcaster`);
  redirect(`${back}&fc=${r.matched}${r.partial ? "&partial=1" : ""}#farcaster`);
}

/** Step 3 (finish): follow the chosen starter packs and Farcaster matches, then land on Today. */
export async function finishOnboardingAction(fd: FormData) {
  const user = await requireUser();
  if (fd.get("skip") !== "1") {
    await applyPacks(user.id, pickPackIds(fd.getAll("packs").map(String)));
    await confirmSuggestions(user.id, fd.getAll("ids").map(String));
  }
  if (!user.onboardedAt) await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
  revalidatePath("/", "layout");
  redirect("/?welcome=1");
}
