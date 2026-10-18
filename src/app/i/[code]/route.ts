import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE, parseInviteCode } from "@/lib/invites";
import { findInviter } from "@/lib/invites-db";

export const dynamic = "force-dynamic";

/** Relative Location, so the redirect stays on whatever host the link was opened on. */
function to(path: string) {
  return new NextResponse(null, { status: 307, headers: { location: path, "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

/**
 * Personal invite link (src/lib/invites.ts). Visitors land on the home page with the code in a
 * cookie that sign-up reads; members already signed in just see the inviter's profile.
 * An unknown code still lands on the home page, without the cookie.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = parseInviteCode((await params).code);
  const inviter = code ? await findInviter(code) : null;
  if (!code || !inviter) return to("/");
  if (await getCurrentUser()) return to(`/u/${encodeURIComponent(inviter.handle)}`);
  const res = to("/");
  res.cookies.set(INVITE_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE,
  });
  return res;
}
