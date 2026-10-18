import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER, REQUEST_ID_HEADER, newRequestId, requestIdFrom } from "@/lib/request-id";
import { contentSecurityPolicy, makeNonce } from "@/lib/security-headers";

/**
 * Per-request CSP nonce (Next reads it from the request's CSP header and applies it to its
 * scripts), a request id for log correlation (echoed on the response) and the requested path.
 */
export function middleware(request: NextRequest) {
  const requestId = requestIdFrom(request.headers) ?? newRequestId();
  const nonce = makeNonce();
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV !== "production" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Overwrites any client copy. Lets requireUser() send signed-out visitors back here after sign-in.
  requestHeaders.set(PATHNAME_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
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
