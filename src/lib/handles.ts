/** Member handles (@name): format, reserved words, and the placeholder a nameless sign-up gets. Pure, unit tested. */
import { handleFromName } from "./auth-core";

export const HANDLE_RE = /^[a-z0-9_]{2,24}$/;

/** Words that would read as official, or collide with app routes. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin", "administrator", "api", "app", "auth", "connect", "empowertours", "help", "login", "logout",
  "me", "mod", "moderator", "monad", "new_member", "null", "official", "root", "settings", "staff",
  "support", "system", "team", "undefined", "welcome",
]);

/**
 * A sign-up without a name (a passkey sign-in for a wallet that has no profile yet) is created as
 * "New member", which turns into the handle new_member, new_member2, ... Such handles are
 * placeholders: onboarding and Edit profile ask the member to pick a real one.
 */
export const PLACEHOLDER_NAME = "New member";
const PLACEHOLDER_RE = /^(new_member|member|user)\d*$/;

export function isPlaceholderHandle(handle: string): boolean {
  return PLACEHOLDER_RE.test(handle);
}

export function isPlaceholderName(name: string): boolean {
  return name.trim().toLowerCase() === PLACEHOLDER_NAME.toLowerCase();
}

/**
 * The account still has what a nameless sign-up generated: the "New member" name and a
 * placeholder-shaped handle. A member who picked a handle like user3 themselves, or already set a
 * real name, is not touched.
 */
export function isGeneratedPlaceholder(user: { handle: string; name: string }): boolean {
  return isPlaceholderHandle(user.handle) && isPlaceholderName(user.name);
}

/** "@Ana_Ruiz " -> "ana_ruiz". */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export type HandleError = "handle_format" | "handle_reserved";

export function validateHandle(raw: string): { ok: true; value: string } | { ok: false; error: HandleError } {
  const h = normalizeHandle(raw);
  if (!HANDLE_RE.test(h)) return { ok: false, error: "handle_format" };
  if (RESERVED_HANDLES.has(h) || isPlaceholderHandle(h)) return { ok: false, error: "handle_reserved" };
  return { ok: true, value: h };
}

/** A free, valid handle built from the member's name; null when the name gives nothing usable. */
export function suggestHandle(name: string, taken: Set<string>): string | null {
  if (!name.trim() || isPlaceholderName(name)) return null;
  const blocked = new Set([...taken, ...RESERVED_HANDLES]);
  const h = handleFromName(name, blocked);
  return validateHandle(h).ok ? h : null;
}
