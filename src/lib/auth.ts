import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { MAGIC_LINK_TTL_MS, SESSION_TTL_MS, handleFromEmail, isLinkUsable, normalizeEmail } from "./auth-core";
import { isLocale, type Locale } from "./i18n";

export const SESSION_COOKIE = "corridor_session";
export const LANG_COOKIE = "corridor_lang";

function token() {
  return randomBytes(32).toString("hex");
}

export async function createSession(userId: string) {
  const id = token();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await prisma.session.deleteMany({ where: { id } });
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function getLocale(): Promise<Locale> {
  const user = await getCurrentUser();
  if (user && isLocale(user.locale)) return user.locale;
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(c) ? c : "en";
}

export async function getWorkspace(userId: string) {
  return (
    (await prisma.workspace.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.workspace.create({ data: { name: "My pipeline", ownerId: userId } }))
  );
}

export async function ensureUser(email: string) {
  const normalized = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return existing;
  const taken = new Set((await prisma.user.findMany({ select: { handle: true } })).map((u) => u.handle));
  const handle = handleFromEmail(normalized, taken);
  const user = await prisma.user.create({ data: { email: normalized, name: handle, handle } });
  await getWorkspace(user.id);
  return user;
}

export async function issueMagicLink(email: string): Promise<string> {
  const t = token();
  await prisma.magicLink.create({ data: { token: t, email: normalizeEmail(email), expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS) } });
  return t;
}

export async function consumeMagicLink(t: string): Promise<string | null> {
  const link = await prisma.magicLink.findUnique({ where: { token: t } });
  if (!link || !isLinkUsable(link)) return null;
  await prisma.magicLink.update({ where: { token: t }, data: { usedAt: new Date() } });
  return link.email;
}
