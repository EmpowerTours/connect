import "server-only";
import { cache } from "react";
import { prisma } from "./db";
import { getKnownRefs } from "./feed";
import type { Locale } from "./i18n";

export const getChannels = cache(() => prisma.channel.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } }));

/** `viewer` is null for signed-out visitors on public pages: cards then show counts and a sign-in link. */
export async function getPostCtx(viewer: { name: string; handle: string } | null, locale: Locale) {
  const [known, channels] = await Promise.all([getKnownRefs(), getChannels()]);
  return { locale, known, channels, viewer: viewer ? { name: viewer.name, handle: viewer.handle } : null };
}
