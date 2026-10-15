/**
 * Mera session token + cookie helpers. Mirrors Hunt's lib/auth/mera.ts:
 * an opaque HMAC-SHA256 token `v1.<b64url payload>.<b64url mac>` keyed by
 * AUTH_SESSION_SECRET (≥ 32 chars), in an HttpOnly, SameSite=Lax cookie.
 * A missing or short secret fails closed: nothing can be minted or verified.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isAddress } from "viem";
import { BRAND } from "../brand";

export const MERA_SESSION_COOKIE = `${BRAND.subdomain}_session`;
/** Seven days, same as Hunt. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const TOKEN_VERSION = "v1";
export const MIN_SECRET_LENGTH = 32;

export type SessionResult = { ok: true; wallet: string; credentialId: string | null } | { ok: false; reason: string };

interface SessionPayload {
  w: string;
  c?: string;
  iat: number;
  exp: number;
}

function sessionSecret(): Buffer | null {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return Buffer.from(secret, "utf8");
}

export function meraSessionConfigured(): boolean {
  return sessionSecret() !== null;
}

function sign(body: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueSession(walletAddress: string, credentialId?: string | null, nowMs: number = Date.now()): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured");
  if (!isAddress(walletAddress, { strict: false })) throw new Error("issueSession requires a wallet address");
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = { w: walletAddress.toLowerCase(), iat, exp: iat + SESSION_TTL_SECONDS };
  if (credentialId) payload.c = credentialId.slice(0, 256);
  const body = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return `${body}.${sign(body, secret)}`;
}

export function readSession(token: string | null | undefined, nowMs: number = Date.now()): SessionResult {
  const bad = { ok: false as const, reason: "invalid session" };
  const secret = sessionSecret();
  if (!secret) return bad;
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return bad;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return bad;
  const body = token.slice(0, lastDot);
  if (!body.startsWith(`${TOKEN_VERSION}.`)) return bad;
  const expected = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(token.slice(lastDot + 1), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return bad;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body.slice(TOKEN_VERSION.length + 1), "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return bad;
  }
  if (typeof payload?.w !== "string" || !isAddress(payload.w, { strict: false })) return bad;
  if (!(typeof payload.exp === "number" && Number.isFinite(payload.exp))) return bad;
  if (!(payload.exp * 1000 > nowMs)) return { ok: false, reason: "session expired" };
  return { ok: true, wallet: payload.w.toLowerCase(), credentialId: typeof payload.c === "string" ? payload.c : null };
}

/** A fresh challenge nonce in the format verify.ts accepts. */
export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function secureAttribute(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookieHeader(token: string): string {
  return [`${MERA_SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_SECONDS}`].join("; ").concat(secureAttribute());
}

export function clearSessionCookieHeader(name: string = MERA_SESSION_COOKIE): string {
  return [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"].join("; ").concat(secureAttribute());
}
