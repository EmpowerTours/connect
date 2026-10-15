import { NextResponse, type NextRequest } from "next/server";
import { consumeMagicLink, createSession, ensureUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const email = token ? await consumeMagicLink(token) : null;
  if (!email) return NextResponse.redirect(new URL("/login?error=link", req.url));
  const user = await ensureUser(email);
  await createSession(user.id);
  return NextResponse.redirect(new URL("/", req.url));
}
