import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, SEND_LIMITS, grantInvite, startCheck, verifyCheck } from "@/lib/protocol/sponsor/checks";
import { codeHash, identityHash, maskAddress, newCode, normalizeEmailIdentity, normalizePhoneIdentity, sameHash, sponsorSecret } from "@/lib/protocol/sponsor/identity";
import { availableChannels, checkSponsorEnv, codeMessage, consoleSender, emailSender, resendSender, smsSender, type CodeSender } from "@/lib/protocol/sponsor/senders";
import { MemorySponsorStore } from "@/lib/protocol/sponsor/store";
import { checkProtocolEnv } from "@/lib/protocol/env-check";

const SECRET = "test-secret-test-secret-test-secret";

function capture(channel: "email" | "phone" = "email") {
  const sent: { to: string; code: string }[] = [];
  const sender: CodeSender = { channel, provider: "test", send: async (to, code) => void sent.push({ to, code }) };
  return { sent, sender };
}

function setup() {
  const store = new MemorySponsorStore();
  const { sent, sender } = capture();
  const t0 = new Date("2026-10-18T10:00:00Z");
  const start = (userId: string, address: string, extra: Partial<Parameters<typeof startCheck>[0]> = {}) =>
    startCheck({ store, sender, secret: SECRET, userId, channel: "email", address, ipHash: "ip1", now: t0, ...extra });
  const verify = (userId: string, code: string, now = t0) => verifyCheck({ store, secret: SECRET, userId, code, now });
  return { store, sent, sender, t0, start, verify };
}

describe("sponsor identity", () => {
  it("normalizes emails to the inbox that receives them", () => {
    expect(normalizeEmailIdentity(" Ana.Lopez+promo@GoogleMail.com ")).toBe("analopez@gmail.com");
    expect(normalizeEmailIdentity("a.b+x@empowertours.com")).toBe("a.b@empowertours.com");
    expect(normalizeEmailIdentity("+x@gmail.com")).toBeNull();
    expect(normalizeEmailIdentity("not-an-email")).toBeNull();
  });

  it("normalizes phones to E.164", () => {
    expect(normalizePhoneIdentity("+52 (55) 1234-5678")).toBe("+525512345678");
    expect(normalizePhoneIdentity("5512345678")).toBeNull();
    expect(normalizePhoneIdentity("+0123456789")).toBeNull();
  });

  it("hashes are keyed, stable and never contain the address", () => {
    const h = identityHash("email", "ana@gmail.com", SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(identityHash("email", "ana@gmail.com", SECRET));
    expect(h).not.toBe(identityHash("email", "ana@gmail.com", "other-secret"));
    expect(h).not.toBe(identityHash("phone", "ana@gmail.com", SECRET));
  });

  it("codes are 6 digits and bound to their check", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
    expect(sameHash(codeHash("a", "123456", SECRET), codeHash("a", "123456", SECRET))).toBe(true);
    expect(sameHash(codeHash("a", "123456", SECRET), codeHash("b", "123456", SECRET))).toBe(false);
    expect(sameHash("", "")).toBe(false);
  });

  it("masks addresses", () => {
    expect(maskAddress("email", "ana@gmail.com")).toBe("a•••@gmail.com");
    expect(maskAddress("phone", "+525512345678")).toBe("+52•••••5678");
  });

  it("needs a secret in production", () => {
    expect(() => sponsorSecret({ NODE_ENV: "production" })).toThrow();
    expect(sponsorSecret({ NODE_ENV: "production", AUTH_SESSION_SECRET: "s" })).toBe("s");
    expect(sponsorSecret({ NODE_ENV: "production", AUTH_SESSION_SECRET: "s", SPONSOR_IDENTITY_SECRET: "p" })).toBe("p");
  });
});

describe("email check", () => {
  it("sends a code and grants sponsorship once verified; only hashes are stored", async () => {
    const s = setup();
    const r = await s.start("u1", "Ana+x@gmail.com");
    expect(r).toMatchObject({ ok: true, sentTo: "a•••@gmail.com" });
    expect(s.sent[0].to).toBe("ana@gmail.com");
    expect(JSON.stringify(s.store.checks)).not.toContain("ana");
    expect(JSON.stringify(s.store.checks)).not.toContain(s.sent[0].code);
    expect(await s.verify("u1", s.sent[0].code)).toEqual({ ok: true, channel: "email" });
    expect(s.store.grants[0]).toMatchObject({ userId: "u1", source: "verified", channel: "email" });
    expect(JSON.stringify(s.store.grants)).not.toContain("ana");
    expect(await s.start("u1", "other@x.com")).toMatchObject({ ok: false, code: "already_sponsored" });
  });

  it("one email grants one account, including plus and dot variants", async () => {
    const s = setup();
    await s.start("u1", "ana@gmail.com");
    await s.verify("u1", s.sent[0].code);
    // The second account still gets a code: whether the address is used is only revealed after proving control.
    expect((await s.start("u2", "A.N.A+2@gmail.com")).ok).toBe(true);
    expect(await s.verify("u2", s.sent[1].code)).toMatchObject({ ok: false, code: "identity_used" });
    expect(await s.store.hasSponsorship("u2")).toBe(false);
  });

  it("wrong codes count and lock the check", async () => {
    const s = setup();
    await s.start("u1", "ana@gmail.com");
    const wrong = s.sent[0].code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(await s.verify("u1", wrong)).toMatchObject({ code: "wrong_code", attemptsLeft: MAX_ATTEMPTS - i });
    expect(await s.verify("u1", wrong)).toMatchObject({ code: "wrong_code", attemptsLeft: 0 });
    expect(await s.verify("u1", s.sent[0].code)).toMatchObject({ ok: false, code: "no_check" });
    expect(await s.store.hasSponsorship("u1")).toBe(false);
  });

  it("codes expire after 10 minutes and a new code replaces the old one", async () => {
    const s = setup();
    await s.start("u1", "ana@gmail.com");
    expect(await s.verify("u1", s.sent[0].code, new Date(s.t0.getTime() + 10 * 60_000))).toMatchObject({ code: "expired" });
    await s.start("u1", "ana@gmail.com");
    await s.start("u1", "ana@gmail.com");
    expect(await s.verify("u1", s.sent[1].code)).toMatchObject({ code: "wrong_code" });
    expect(await s.verify("u1", s.sent[2].code)).toMatchObject({ ok: true });
  });

  it("limits code sends per member, per address and per IP", async () => {
    const s = setup();
    for (let i = 0; i < SEND_LIMITS.memberPerHour; i++) expect((await s.start("u1", `a${i}@x.com`)).ok).toBe(true);
    expect(await s.start("u1", "z@x.com")).toMatchObject({ ok: false, code: "rate_limited", status: 429 });

    for (let i = 0; i < SEND_LIMITS.addressPerHour; i++) expect((await s.start(`v${i}`, "same@x.com", { ipHash: `ip-v${i}` })).ok).toBe(true);
    expect(await s.start("v9", "same@x.com", { ipHash: "ip-v9" })).toMatchObject({ code: "rate_limited" });

    const ip = setup();
    for (let i = 0; i < SEND_LIMITS.ipPerHour; i++) expect((await ip.start(`w${i}`, `w${i}@x.com`)).ok).toBe(true);
    expect(await ip.start("w99", "w99@x.com")).toMatchObject({ code: "rate_limited" });
    expect((await ip.start("w99", "w99@x.com", { now: new Date(ip.t0.getTime() + 3_600_001) })).ok).toBe(true);
  });

  it("a failed send is reported and still counts toward the limits", async () => {
    const store = new MemorySponsorStore();
    const sender: CodeSender = { channel: "email", provider: "down", send: async () => { throw new Error("503"); } };
    const r = await startCheck({ store, sender, secret: SECRET, userId: "u1", channel: "email", address: "a@x.com", ipHash: null });
    expect(r).toMatchObject({ ok: false, code: "send_failed", status: 502 });
    expect(store.checks[0].status).toBe("failed");
    expect(await verifyCheck({ store, secret: SECRET, userId: "u1", code: "123456" })).toMatchObject({ code: "no_check" });
  });

  it("refuses bad addresses and channels without a provider", async () => {
    const s = setup();
    expect(await s.start("u1", "nope")).toMatchObject({ code: "invalid_address", status: 400 });
    expect(await startCheck({ store: s.store, sender: null, secret: SECRET, userId: "u1", channel: "phone", address: "+525512345678", ipHash: null })).toMatchObject({ code: "channel_off" });
    expect(await startCheck({ store: s.store, sender: s.sender, secret: SECRET, userId: "u1", channel: "phone", address: "+525512345678", ipHash: null })).toMatchObject({ code: "channel_off" });
  });

  it("phone works through the same flow with an SMS provider", async () => {
    const store = new MemorySponsorStore();
    const { sent, sender } = capture("phone");
    expect((await startCheck({ store, sender, secret: SECRET, userId: "u1", channel: "phone", address: "+52 55 1234 5678", ipHash: null })).ok).toBe(true);
    expect(sent[0].to).toBe("+525512345678");
    expect(await verifyCheck({ store, secret: SECRET, userId: "u1", code: sent[0].code })).toEqual({ ok: true, channel: "phone" });
  });
});

describe("invite grants", () => {
  it("grant invite sign-ups, at most 20 per inviter per rolling day", async () => {
    const store = new MemorySponsorStore();
    store.members.add("inviter");
    const t0 = new Date("2026-10-18T10:00:00Z");
    for (let i = 0; i < 20; i++) expect(await grantInvite({ store, userId: `n${i}`, inviterId: "inviter", now: t0 })).toEqual({ granted: true });
    expect(await grantInvite({ store, userId: "n20", inviterId: "inviter", now: t0 })).toEqual({ granted: false, reason: "inviter_limit" });
    expect(await grantInvite({ store, userId: "n20", inviterId: "inviter", now: new Date(t0.getTime() + 86_400_001) })).toEqual({ granted: true });
    expect(store.grants.find((g) => g.userId === "n0")).toMatchObject({ source: "invite", inviterId: "inviter" });
  });

  it("refuses self-invites, unknown inviters and a second grant", async () => {
    const store = new MemorySponsorStore();
    store.members.add("inviter");
    expect(await grantInvite({ store, userId: "inviter", inviterId: "inviter" })).toEqual({ granted: false, reason: "self_invite" });
    expect(await grantInvite({ store, userId: "x", inviterId: "ghost" })).toEqual({ granted: false, reason: "unknown_inviter" });
    await grantInvite({ store, userId: "x", inviterId: "inviter" });
    expect(await grantInvite({ store, userId: "x", inviterId: "inviter" })).toEqual({ granted: false, reason: "already_sponsored" });
  });
});

describe("code senders", () => {
  it("picks providers from env and keeps console out of production", () => {
    expect(emailSender({})).toBeNull();
    expect(emailSender({ SPONSOR_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" })).toBeNull();
    expect(emailSender({ SPONSOR_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", SPONSOR_EMAIL_FROM: "Connect <codes@x.com>" })?.provider).toBe("resend");
    expect(emailSender({ SPONSOR_EMAIL_PROVIDER: "console" })?.provider).toBe("console");
    expect(emailSender({ SPONSOR_EMAIL_PROVIDER: "console", NODE_ENV: "production" })).toBeNull();
    expect(smsSender({ SPONSOR_SMS_PROVIDER: "console", NODE_ENV: "production" })).toBeNull();
    expect(smsSender({ SPONSOR_SMS_PROVIDER: "twilio" })).toBeNull();
    expect(availableChannels({ SPONSOR_EMAIL_PROVIDER: "console", SPONSOR_SMS_PROVIDER: "console" })).toEqual(["email", "phone"]);
  });

  it("Resend gets the code in the message and the key only in the header", async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const s = resendSender("re_test", "Connect <codes@x.com>", async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    });
    await s.send("ana@gmail.com", "123456");
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.headers.authorization).toBe("Bearer re_test");
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ to: ["ana@gmail.com"], from: "Connect <codes@x.com>" });
    expect(body.text).toContain("123456");
    expect(calls[0].init.body).not.toContain("re_test");
    const failing = resendSender("k", "f@x.com", async () => ({ ok: false, status: 429 }));
    await expect(failing.send("a@x.com", "1")).rejects.toThrow("429");
  });

  it("console sender logs the code, not the address", async () => {
    const lines: string[] = [];
    await consoleSender("email", (l) => lines.push(l)).send("ana@gmail.com", "654321");
    expect(lines.join()).toContain("654321");
    expect(lines.join()).not.toContain("ana");
    expect(codeMessage("111222").subject).toContain("111222");
  });

  it("env checks: console refused in production, Resend needs its key and sender, no paid SMS wired", () => {
    expect(checkSponsorEnv({}).errors).toEqual([]);
    expect(checkSponsorEnv({ NODE_ENV: "production", SPONSOR_EMAIL_PROVIDER: "console" }).errors.join()).toContain("local development only");
    expect(checkSponsorEnv({ SPONSOR_EMAIL_PROVIDER: "resend" }).errors.join()).toMatch(/RESEND_API_KEY.*SPONSOR_EMAIL_FROM/);
    expect(checkSponsorEnv({ SPONSOR_SMS_PROVIDER: "twilio" }).errors.join()).toContain("no SMS provider is wired");
    expect(checkSponsorEnv({ NODE_ENV: "production", SPONSOR_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", SPONSOR_EMAIL_FROM: "a@x.com" }).warnings.join()).toContain("SPONSOR_IDENTITY_SECRET");
    expect(checkProtocolEnv({ NODE_ENV: "production", SPONSOR_EMAIL_PROVIDER: "console" }).errors.join()).toContain("SPONSOR_EMAIL_PROVIDER");
  });

  it("the sponsor code never imports Mera key handling or sends transactions", () => {
    const dir = path.join(process.cwd(), "src/lib/protocol/sponsor");
    for (const f of ["identity.ts", "senders.ts", "store.ts", "checks.ts"]) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src).not.toMatch(/mera\/|createWalletClient|sendTransaction|writeContract/);
    }
  });
});
