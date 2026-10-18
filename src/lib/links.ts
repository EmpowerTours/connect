/**
 * Link normalization for profile links and claim evidence. Only http(s) URLs
 * survive (no javascript:, data:, credentials or bare hosts with spaces), and
 * http is upgraded to https.
 */
export type LinkResult = { ok: true; value: string } | { ok: false };

const MAX_URL = 300;

export function normalizeWebUrl(raw: string): LinkResult {
  const input = raw.trim();
  if (!input) return { ok: true, value: "" };
  if (input.length > MAX_URL || /\s/.test(input)) return { ok: false };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    // Intentional: unparseable user input is a validation result, not an error.
    return { ok: false };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false };
  if (url.username || url.password) return { ok: false };
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return { ok: false };
  url.protocol = "https:";
  url.hash = "";
  return { ok: true, value: url.toString().replace(/\/$/, "") };
}

function hostIs(url: string, hosts: string[]): URL | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase().replace(/^(www\.|mobile\.)/, "");
    return hosts.includes(h) ? u : null;
  } catch {
    // Intentional: not a URL, so not one of these hosts.
    return null;
  }
}

/** "@ana", "ana", "x.com/ana", "https://twitter.com/ana" → "https://x.com/ana". */
export function normalizeXHandle(raw: string): LinkResult {
  const input = raw.trim();
  if (!input) return { ok: true, value: "" };
  let handle = input.replace(/^@/, "");
  if (/[/.]/.test(handle)) {
    const r = normalizeWebUrl(input);
    const u = r.ok && r.value ? hostIs(r.value, ["x.com", "twitter.com"]) : null;
    if (!u) return { ok: false };
    handle = u.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return { ok: false };
  return { ok: true, value: `https://x.com/${handle}` };
}

/** Only linkedin.com/in/<id> or linkedin.com/company/<id>. */
export function normalizeLinkedIn(raw: string): LinkResult {
  const input = raw.trim();
  if (!input) return { ok: true, value: "" };
  const r = normalizeWebUrl(input);
  const u = r.ok && r.value ? hostIs(r.value, ["linkedin.com"]) : null;
  if (!u) return { ok: false };
  const [kind, id] = u.pathname.split("/").filter(Boolean);
  if ((kind !== "in" && kind !== "company") || !id || !/^[A-Za-z0-9_\-%.]{2,100}$/.test(id)) return { ok: false };
  return { ok: true, value: `https://www.linkedin.com/${kind}/${id}` };
}

/** Short label for a link: "x.com/ana", "linkedin.com/in/ana", "acme.com". */
export function linkLabel(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

const NEXT_MAX = 512;
const NEXT_BASE = "https://next.invalid";
/** Pages a sign-in must never bounce back to. */
const NEXT_REFUSED_PAGES = ["/login", "/welcome"];
const NEXT_REFUSED_PREFIXES = ["/api/", "/auth/"];

/**
 * The page to return to after sign-in (`/login?next=…`). Only a same-origin path survives:
 * no scheme, no "//host" or "/\host" (browsers treat both as another origin), no control
 * characters, nothing that loops back into sign-in. Anything else is null (go to "/").
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > NEXT_MAX) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, NEXT_BASE);
  } catch {
    // Intentional: an unparseable path is simply not used.
    return null;
  }
  if (url.origin !== NEXT_BASE) return null;
  const p = url.pathname;
  if (p === "/") return null;
  if (NEXT_REFUSED_PAGES.some((r) => p === r || p.startsWith(`${r}/`))) return null;
  if (NEXT_REFUSED_PREFIXES.some((r) => p.startsWith(r) || p === r.slice(0, -1))) return null;
  return `${p}${url.search}${url.hash}`;
}

/**
 * `/login`, carrying the page to come back to when there is one worth keeping. `join` opens the
 * create-account form straight away (sign-up prompts on public pages).
 */
export function loginPath(next: string | null | undefined, opts: { join?: boolean } = {}): string {
  const safe = safeNextPath(next);
  const q = [opts.join ? "join=1" : "", safe ? `next=${encodeURIComponent(safe)}` : ""].filter(Boolean).join("&");
  return q ? `/login?${q}` : "/login";
}
