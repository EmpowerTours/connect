import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getLocale } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { checkLimits, clientIp, defaultRateLimitStore, type LimitName, type LimitResult } from "@/lib/rate-limit";

/** Limit a signed-in member's action. */
export function limitMember(userId: string, ...names: LimitName[]): Promise<LimitResult> {
  return checkLimits(defaultRateLimitStore(), names, `u:${userId}`);
}

/** Limit by client IP (sign-in, anything before a session exists). */
export async function limitIp(...names: LimitName[]): Promise<LimitResult> {
  return checkLimits(defaultRateLimitStore(), names, `ip:${clientIp(await headers())}`);
}

export function rateLimitMessage(locale: Locale, retryAfter: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return `${t(locale, "rateLimit.tooMany")} ${t(locale, minutes === 1 ? "rateLimit.tryInOne" : "rateLimit.tryIn").replace("{n}", String(minutes))}`;
}

/** 429 JSON with Retry-After and a friendly message in the visitor's language (client code shows `error`). */
export async function tooManyResponse(r: LimitResult): Promise<NextResponse> {
  const locale = await getLocale();
  return NextResponse.json(
    { error: rateLimitMessage(locale, r.retryAfter), code: "rate_limited", retryAfter: r.retryAfter },
    { status: 429, headers: { "retry-after": String(r.retryAfter), "cache-control": "no-store" } },
  );
}
