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
