import "server-only";
import { cache } from "react";
import { prisma } from "./db";
import { getKnownRefs } from "./feed";
import type { Locale } from "./i18n";

export const getChannels = cache(() => prisma.channel.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } }));

export async function getPostCtx(viewer: { name: string; handle: string }, locale: Locale) {
  const [known, channels] = await Promise.all([getKnownRefs(), getChannels()]);
  return { locale, known, channels, viewer: { name: viewer.name, handle: viewer.handle } };
}
