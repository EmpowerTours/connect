import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, makeNonce } from "@/lib/security-headers";

/** Per-request CSP nonce. Next reads it from the request's CSP header and applies it to its scripts. */
export function middleware(request: NextRequest) {
  const nonce = makeNonce();
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV !== "production" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: skip static assets, uploaded media and JSON APIs. Skip prefetches, which reuse the page's nonce.
      source: "/((?!_next/static|_next/image|media/|api/|favicon.ico|logos/|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
