/**
 * Request ids for log correlation. src/middleware.ts stamps `x-request-id` on page requests
 * (reusing an upstream id from Railway's edge when present); API routes, which skip the
 * middleware, fall back to the upstream header directly.
 */
export const REQUEST_ID_HEADER = "x-request-id";
const UPSTREAM = ["x-request-id", "x-railway-request-id", "cf-ray"] as const;
const SAFE = /^[A-Za-z0-9._:-]{1,128}$/;

type HeaderBag = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function read(h: HeaderBag, name: string): string | undefined {
  if (typeof (h as { get?: unknown }).get === "function") return (h as { get(n: string): string | null }).get(name) ?? undefined;
  const v = (h as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v[0] : v;
}

/** An upstream id if it looks safe to log, otherwise undefined. */
export function requestIdFrom(h: HeaderBag): string | undefined {
  for (const name of UPSTREAM) {
    const v = read(h, name)?.trim();
    if (v && SAFE.test(v)) return v;
  }
  return undefined;
}

/** A new random id (Web Crypto, so it also works in the edge middleware). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** The current request's id inside server components, actions and route handlers. */
export async function currentRequestId(): Promise<string | undefined> {
  try {
    const { headers } = await import("next/headers");
    return requestIdFrom(await headers());
  } catch {
    // Intentional: outside a request scope (scripts, tests, background work) there is no id.
    return undefined;
  }
}
