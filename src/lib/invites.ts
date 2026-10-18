/**
 * Personal invite links: /i/<code>. Opening one stores the code in a short-lived cookie, and the
 * sign-up that follows (POST /api/auth/register) records the inviter on the new account. Codes are
 * random, not derived from the handle, so a link keeps working after a rename and reveals nothing.
 *
 * Pure and client-safe: no database. The database side is src/lib/invites-db.ts.
 */

/** Cookie set by /i/<code> and read once at sign-up. */
export const INVITE_COOKIE = "connect_invite";
/** Last link opened wins for this long. */
export const INVITE_COOKIE_DAYS = 30;
export const INVITE_COOKIE_MAX_AGE = INVITE_COOKIE_DAYS * 86_400;

/** No 0/o or 1/l/i, so a code read aloud or retyped survives. */
export const INVITE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const INVITE_CODE_LENGTH = 8;

const CODE_RE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** A fresh code from crypto randomness (31^8 ≈ 8.5e11 codes; the unique index catches the rest). */
export function newInviteCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const out: string[] = [];
  // Rejection sampling keeps every letter equally likely (256 is not a multiple of 31).
  const limit = 256 - (256 % INVITE_ALPHABET.length);
  while (out.length < INVITE_CODE_LENGTH) {
    for (const b of random(INVITE_CODE_LENGTH * 2)) {
      if (b >= limit) continue;
      out.push(INVITE_ALPHABET[b % INVITE_ALPHABET.length]);
      if (out.length === INVITE_CODE_LENGTH) break;
    }
  }
  return out.join("");
}

/** The code from a URL segment or cookie, or null when it cannot be one of ours. */
export function parseInviteCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}

/** Absolute invite link on the given origin (APP_URL in production). */
export function inviteUrl(base: string, code: string): string {
  return `${base.replace(/\/$/, "")}/i/${code}`;
}
