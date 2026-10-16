/**
 * Security headers. Static ones are set for every response in next.config.ts; the CSP carries a
 * per-request nonce and is set by src/middleware.ts (all pages render dynamically: the root layout
 * reads the locale cookie, so Next stamps the nonce on its own scripts).
 *
 * Connect loads nothing from third parties: fonts are bundled, passkey ceremonies are browser APIs,
 * and photos are served from /media on this origin, so every directive can stay at 'self'.
 */
export function contentSecurityPolicy(nonce: string, opts: { dev?: boolean } = {}): string {
  const dev = !!opts.dev;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets the nonced Next runtime load its chunks; dev needs eval for React refresh.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Inline style attributes (sizes, tints) are used throughout; styles cannot run code.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function staticSecurityHeaders(opts: { production?: boolean } = {}): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
  ];
  // HSTS only where TLS is guaranteed (Railway terminates TLS for custom domains).
  if (opts.production) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}

/** 128-bit random nonce, base64. Works in the edge and node runtimes. */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
