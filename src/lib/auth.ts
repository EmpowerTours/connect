import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "./admin";
import { prisma } from "./db";
import { SESSION_TTL_MS, devLoginAllowed, handleFromEmail, normalizeEmail } from "./auth-core";
import { BRAND } from "./brand";
import { isLocale, type Locale } from "./i18n";
import { MERA_SESSION_COOKIE, readSession } from "./mera/session";

/**
 * Two ways to hold a session:
 *
 * 1. Mera passkey wallet (the real one). An HMAC-signed cookie minted by
 *    /api/auth/session after a server-verified EIP-712 signature; it names a
 *    wallet, and the user is the profile linked to that wallet.
 * 2. LOCAL DEMO login (dev only). A DB-backed cookie for the seeded demo user.
 *    Ignored entirely when devLoginAllowed() is false (production builds
 *    without ALLOW_DEV_LOGIN=1), so it cannot be used to bypass Mera.
 */
export const DEMO_SESSION_COOKIE = `${BRAND.subdomain}_demo_session`;
export const LANG_COOKIE = `${BRAND.subdomain}_lang`;
export const DEMO_EMAIL = "demo@corridor.local";

function token() {
  return randomBytes(32).toString("hex");
}

/** Local demo login only. */
export async function createDemoSession(userId: string) {
  if (!devLoginAllowed()) throw new Error("demo login is disabled");
  const id = token();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  (await cookies()).set(DEMO_SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(DEMO_SESSION_COOKIE)?.value;
  if (id) await prisma.session.deleteMany({ where: { id } });
  jar.delete(DEMO_SESSION_COOKIE);
  jar.delete(MERA_SESSION_COOKIE);
}

export type AuthMethod = "mera" | "demo";

export async function getCurrentAuth() {
  const jar = await cookies();

  const mera = readSession(jar.get(MERA_SESSION_COOKIE)?.value);
  if (mera.ok) {
    const user = await prisma.user.findUnique({ where: { walletAddress: mera.wallet } });
    if (user && user.walletVerified) return { user, method: "mera" as AuthMethod };
  }

  if (devLoginAllowed()) {
    const id = jar.get(DEMO_SESSION_COOKIE)?.value;
    if (id) {
      const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
      if (session && session.expiresAt > new Date()) return { user: session.user, method: "demo" as AuthMethod };
    }
  }
  return null;
}

export async function getCurrentUser() {
  return (await getCurrentAuth())?.user ?? null;
}

/** Every write action goes through this: no session, no write. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Admin = Mera session for a wallet in ADMIN_WALLETS. Everyone else gets a 404. */
export async function requireAdmin() {
  const auth = await getCurrentAuth();
  if (!auth) redirect("/login");
  if (!isAdmin(auth.user, auth.method)) notFound();
  return auth.user;
}

export async function currentUserIsAdmin(): Promise<boolean> {
  const auth = await getCurrentAuth();
  return !!auth && isAdmin(auth.user, auth.method);
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

/** Used by the local demo login to find/create the seeded demo user. */
export async function ensureUser(email: string) {
  const normalized = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return existing;
  const taken = new Set((await prisma.user.findMany({ select: { handle: true } })).map((u) => u.handle));
  const handle = handleFromEmail(normalized, taken);
  const isDemo = normalized === DEMO_EMAIL;
  const user = await prisma.user.create({
    data: isDemo ? { email: normalized, name: "Demo user", handle: taken.has("demo") ? handle : "demo", isDemo } : { email: normalized, name: handle, handle },
  });
  await getWorkspace(user.id);
  return user;
}
