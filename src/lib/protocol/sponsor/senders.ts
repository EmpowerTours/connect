/**
 * Delivery of one-time sponsorship codes, behind one interface so the provider is config only.
 *
 *   Email (default channel)
 *     SPONSOR_EMAIL_PROVIDER=resend   Resend HTTP API (RESEND_API_KEY, SPONSOR_EMAIL_FROM).
 *     SPONSOR_EMAIL_PROVIDER=console  Development only: the code goes to the server log.
 *   Phone (optional; no paid provider is wired)
 *     SPONSOR_SMS_PROVIDER=console    Development only.
 *     A real SMS provider implements CodeSender and is added to smsSender() below.
 *
 * Unset = that channel is off. Console providers are refused in production.
 */
import { APP_NAME } from "../../brand";
import type { SponsorChannel } from "./identity";

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface CodeSender {
  channel: SponsorChannel;
  /** Provider name for logs and the config route. */
  provider: string;
  /** Delivers the code. Throws on failure; never logs the address. */
  send(to: string, code: string): Promise<void>;
}

export const CODE_TTL_MINUTES = 10;

export function codeMessage(code: string): { subject: string; text: string } {
  return {
    subject: `${code} is your ${APP_NAME} code`,
    text: `Your ${APP_NAME} code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.\n\nIt unlocks free network fees for creating your Connect ID. If you didn't ask for it, ignore this email.`,
  };
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). Plain fetch, no SDK. */
export function resendSender(apiKey: string, from: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): CodeSender {
  return {
    channel: "email",
    provider: "resend",
    async send(to, code) {
      const { subject, text } = codeMessage(code);
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`email provider returned ${res.status}`);
    },
  };
}

/** Development only: prints the code (not the address) so a local run can finish the check. */
export function consoleSender(channel: SponsorChannel, out: (line: string) => void = (l) => console.info(l)): CodeSender {
  return {
    channel,
    provider: "console",
    async send(_to, code) {
      out(`[sponsor] dev ${channel} code: ${code}`);
    },
  };
}

function devOnly(env: Env) {
  return env.NODE_ENV !== "production";
}

export function emailSender(env: Env = process.env, fetchImpl?: FetchLike): CodeSender | null {
  const p = env.SPONSOR_EMAIL_PROVIDER?.trim();
  if (p === "resend" && env.RESEND_API_KEY && env.SPONSOR_EMAIL_FROM) return resendSender(env.RESEND_API_KEY, env.SPONSOR_EMAIL_FROM, fetchImpl);
  if (p === "console" && devOnly(env)) return consoleSender("email");
  return null;
}

export function smsSender(env: Env = process.env): CodeSender | null {
  const p = env.SPONSOR_SMS_PROVIDER?.trim();
  if (p === "console" && devOnly(env)) return consoleSender("phone");
  return null;
}

export function senderFor(channel: SponsorChannel, env: Env = process.env): CodeSender | null {
  return channel === "email" ? emailSender(env) : smsSender(env);
}

/** Channels a member can use right now. */
export function availableChannels(env: Env = process.env): SponsorChannel[] {
  return (["email", "phone"] as const).filter((c) => senderFor(c, env) !== null);
}

/** Boot check for src/lib/env.ts. Names and reasons only. */
export function checkSponsorEnv(env: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = env.NODE_ENV === "production";
  const email = env.SPONSOR_EMAIL_PROVIDER?.trim();
  if (email) {
    if (!["resend", "console"].includes(email)) errors.push("SPONSOR_EMAIL_PROVIDER: must be resend or console");
    if (email === "console" && prod) errors.push("SPONSOR_EMAIL_PROVIDER=console is for local development only");
    if (email === "resend") {
      if (!env.RESEND_API_KEY) errors.push("RESEND_API_KEY: required with SPONSOR_EMAIL_PROVIDER=resend");
      if (!env.SPONSOR_EMAIL_FROM) errors.push("SPONSOR_EMAIL_FROM: required with SPONSOR_EMAIL_PROVIDER=resend (an address on a domain verified in Resend)");
    }
  }
  const sms = env.SPONSOR_SMS_PROVIDER?.trim();
  if (sms) {
    if (sms !== "console") errors.push("SPONSOR_SMS_PROVIDER: only console (development) exists; no SMS provider is wired");
    else if (prod) errors.push("SPONSOR_SMS_PROVIDER=console is for local development only");
  }
  if (prod && !env.SPONSOR_IDENTITY_SECRET && (email || sms)) warnings.push("SPONSOR_IDENTITY_SECRET is not set: email/phone hashes use AUTH_SESSION_SECRET, so rotating that secret would let an address earn sponsorship again");
  return { errors, warnings };
}
