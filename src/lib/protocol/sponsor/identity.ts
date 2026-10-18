/**
 * Normalizing and hashing the email or phone used for the one-time sponsorship check.
 * Only HMACs are stored, so the database can enforce "one grant per email/phone" without holding
 * the addresses. Pure: no database, no network.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export type SponsorChannel = "email" | "phone";
export const SPONSOR_CHANNELS: readonly SponsorChannel[] = ["email", "phone"];

/** Providers whose addresses ignore dots in the local part. */
const DOTLESS = new Set(["gmail.com", "googlemail.com"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The address a person actually receives at, so `Ana.Lopez+x@gmail.com` and `analopez@gmail.com`
 * count as one identity. Plus-tags are dropped for every domain (nearly all providers deliver
 * them to the same inbox); dots only for Gmail. Null if it isn't an email.
 */
export function normalizeEmailIdentity(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (DOTLESS.has(domain)) local = local.replace(/\./g, "");
  if (!local) return null;
  return `${local}@${domain}`;
}

/** E.164 (`+` and 8 to 15 digits). Spaces, dashes, dots and brackets are ignored. Null otherwise. */
export function normalizePhoneIdentity(raw: string): string | null {
  const compact = raw.trim().replace(/[\s\-().]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

export function normalizeIdentity(channel: SponsorChannel, raw: string): string | null {
  return channel === "email" ? normalizeEmailIdentity(raw) : normalizePhoneIdentity(raw);
}

/** HMAC of the normalized address. `secret` must stay stable: changing it lets an address be reused. */
export function identityHash(channel: SponsorChannel, normalized: string, secret: string): string {
  return createHmac("sha256", secret).update(`sponsor-identity:${channel}:${normalized}`).digest("hex");
}

export const CODE_DIGITS = 6;

/** Uniform 6-digit code from the OS CSPRNG. */
export function newCode(): string {
  return randomInt(0, 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, "0");
}

/** HMAC of a code, bound to its check row so a hash can't be replayed onto another check. */
export function codeHash(checkId: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`sponsor-code:${checkId}:${code}`).digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** What the member sees: `a•••@gmail.com`, `+52•••••1234`. */
export function maskAddress(channel: SponsorChannel, normalized: string): string {
  if (channel === "phone") return `${normalized.slice(0, 3)}•••••${normalized.slice(-4)}`;
  const [local, domain] = normalized.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

/**
 * Secret for these HMACs: SPONSOR_IDENTITY_SECRET, else AUTH_SESSION_SECRET (both server-only).
 * A dev fallback only outside production.
 */
export function sponsorSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.SPONSOR_IDENTITY_SECRET || env.AUTH_SESSION_SECRET;
  if (s) return s;
  if (env.NODE_ENV === "production") throw new Error("SPONSOR_IDENTITY_SECRET or AUTH_SESSION_SECRET is required");
  return "connect-dev-sponsor-secret";
}
