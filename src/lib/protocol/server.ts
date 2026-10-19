/**
 * Shared helpers for the protocol API routes. Every route 404s while PROTOCOL_ENABLED is off,
 * and needs a Mera passkey session (the wallet that owns the Connect ID); the demo login never
 * reaches the chain.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAddress, type Address } from "viem";
import { getCurrentAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/log";
import { clientIp } from "@/lib/rate-limit";
import { limitMember, tooManyResponse } from "@/lib/rate-limit-server";
import { getProtocol } from "./config";
import { relayerForwardingEnabled } from "./env-check";
import { grantSponsorship as grant, sponsorEligibility as eligibility } from "./relayer/eligibility";
import type { Eligibility } from "./relayer/policy";

export type ProtocolCtx = NonNullable<ReturnType<typeof getProtocol>>;

export const noStore = { "cache-control": "no-store" };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** The protocol, or a 404 (flag off) / 503 (misconfigured) response. */
export function protocolOr404(): { ok: true; p: ProtocolCtx } | { ok: false; res: NextResponse } {
  try {
    const p = getProtocol();
    if (!p) return { ok: false, res: json({ error: "not found" }, 404) };
    return { ok: true, p };
  } catch (e) {
    logger.error("[protocol] misconfigured", { scope: "protocol", error: e instanceof Error ? e.message : String(e) });
    return { ok: false, res: json({ error: "Connect ID is not available right now." }, 503) };
  }
}

export interface ProtocolMember {
  id: string;
  wallet: Address;
}

/** Signed-in Mera member, rate limited. */
export async function protocolMember(limit = true): Promise<{ ok: true; member: ProtocolMember } | { ok: false; res: NextResponse }> {
  const auth = await getCurrentAuth();
  if (!auth || auth.method !== "mera" || !auth.user.walletAddress || !auth.user.walletVerified) {
    return { ok: false, res: json({ error: "sign in with your passkey first" }, 401) };
  }
  if (limit) {
    const rl = await limitMember(auth.user.id, "protocol");
    if (!rl.ok) return { ok: false, res: await tooManyResponse(rl) };
  }
  return { ok: true, member: { id: auth.user.id, wallet: getAddress(auth.user.walletAddress) } };
}

export async function requestIpHash(): Promise<string | null> {
  return hashIp(clientIp(await headers()));
}

/** HMAC of the client IP, so the per-IP limit works without storing raw IPs. */
export function hashIp(ip: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!ip || ip === "unknown") return null;
  const secret = env.AUTH_SESSION_SECRET || "connect-dev-ip-salt";
  return createHmac("sha256", secret).update(`relay-ip:${ip}`).digest("hex").slice(0, 32);
}

export function sponsorEligibility(userId: string): Promise<Eligibility | null> {
  return eligibility(prisma, userId);
}

export function grantSponsorship(userId: string, g: Eligibility): Promise<void> {
  return grant(prisma, userId, g);
}

/**
 * Forwards a signed request to the relayer service (its own Railway service holding the relayer
 * key). The web app sends who is asking; the relayer re-checks the account and eligibility in
 * Postgres and applies every spend rule itself.
 */
export async function forwardToRelayer(kind: "register" | "action", member: ProtocolMember, payload: unknown): Promise<NextResponse> {
  if (!relayerForwardingEnabled()) {
    return json({ error: "sponsored gas is off", code: "relayer_off", selfPay: true }, 402);
  }
  const base = (process.env.RELAYER_URL ?? "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/relay/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RELAYER_SERVICE_TOKEN}` },
      body: JSON.stringify({ user: { id: member.id, wallet: member.wallet.toLowerCase() }, ipHash: await requestIpHash(), payload }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({ error: "relayer answered without JSON" }))) as Record<string, unknown>;
    return json(body, res.status);
  } catch (e) {
    logger.error("[protocol] relayer unreachable", { scope: "protocol", error: e instanceof Error ? e.message : String(e) });
    return json({ error: "sponsored gas is unavailable right now", code: "relayer_unreachable", selfPay: true }, 503);
  }
}
