"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isFeedAlgorithmId, sanitizeMutes } from "@/lib/feed-algorithms";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const safeBack = (raw: string, fallback: string) => (raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback);

/** Save the member's feed algorithm (used by every feed that has no channel default). */
export async function setFeedAlgorithmAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "algorithm");
  if (!isFeedAlgorithmId(id)) throw new Error("unknown feed algorithm");
  await prisma.user.update({ where: { id: user.id }, data: { feedAlgorithm: id } });
  revalidatePath("/updates");
  redirect(safeBack(str(fd, "back"), "/updates"));
}

/** Save topic and channel mutes (apply to every feed). */
export async function setFeedMutesAction(fd: FormData) {
  const user = await requireUser();
  const channels = await prisma.channel.findMany({ select: { slug: true } });
  const clean = sanitizeMutes(
    { topics: fd.getAll("topics").map(String), channels: fd.getAll("channels").map(String) },
    new Set(channels.map((c) => c.slug)),
  );
  await prisma.user.update({ where: { id: user.id }, data: { mutedTopics: JSON.stringify(clean.topics), mutedChannels: JSON.stringify(clean.channels) } });
  revalidatePath("/updates");
  redirect(safeBack(str(fd, "back"), "/updates"));
}

/** Admins pick what a channel rewards by default. Members can still switch for themselves. */
export async function setChannelDefaultFeedAction(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "algorithm");
  if (id && !isFeedAlgorithmId(id)) throw new Error("unknown feed algorithm");
  const channel = await prisma.channel.update({ where: { id: str(fd, "channelId") }, data: { defaultFeed: id } });
  revalidatePath(`/channels/${channel.slug}`);
  redirect(`/channels/${channel.slug}`);
}
