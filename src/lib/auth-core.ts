/** Pure auth helpers (no I/O) — unit tested. */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isLinkUsable(link: { expiresAt: Date; usedAt: Date | null } | null, now: Date = new Date()): boolean {
  return !!link && !link.usedAt && link.expiresAt.getTime() > now.getTime();
}

/** Derives a unique handle from the email local part. */
export function handleFromEmail(email: string, taken: Set<string>): string {
  const base =
    normalizeEmail(email)
      .split("@")[0]
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 20) || "user";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${Date.now()}`;
}

export function devLoginAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.ALLOW_DEV_LOGIN === "1";
}
