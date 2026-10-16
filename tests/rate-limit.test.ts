import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryRateLimitStore,
  RATE_LIMITS,
  RedisRateLimitStore,
  checkLimit,
  checkLimits,
  clientIp,
  defaultRateLimitStore,
  type RateLimitStore,
} from "@/lib/rate-limit";
import { MESSAGES } from "@/lib/i18n";

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

describe("fixed-window rate limits", () => {
  it("allows up to the limit, then refuses with a Retry-After inside the window", async () => {
    const store = new MemoryRateLimitStore(() => T0);
    const { limit } = RATE_LIMITS.authVerify;
    for (let i = 0; i < limit; i++) expect((await checkLimit(store, "authVerify", "ip:1.2.3.4", T0)).ok).toBe(true);
    const r = await checkLimit(store, "authVerify", "ip:1.2.3.4", T0 + 5_000);
    expect(r).toMatchObject({ ok: false, remaining: 0 });
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(RATE_LIMITS.authVerify.windowSeconds);
  });

  it("counts subjects and rules separately", async () => {
    const store = new MemoryRateLimitStore(() => T0);
    for (let i = 0; i < RATE_LIMITS.report.limit; i++) await checkLimit(store, "report", "u:a", T0);
    expect((await checkLimit(store, "report", "u:a", T0)).ok).toBe(false);
    expect((await checkLimit(store, "report", "u:b", T0)).ok).toBe(true);
    expect((await checkLimit(store, "intro", "u:a", T0)).ok).toBe(true);
  });

  it("opens again in the next window", async () => {
    let now = T0;
    const store = new MemoryRateLimitStore(() => now);
    for (let i = 0; i <= RATE_LIMITS.post.limit; i++) await checkLimit(store, "post", "u:a", now);
    expect((await checkLimit(store, "post", "u:a", now)).ok).toBe(false);
    now += RATE_LIMITS.post.windowSeconds * 1000;
    expect((await checkLimit(store, "post", "u:a", now)).ok).toBe(true);
  });

  it("checkLimits applies every rule: the daily cap holds even when each minute is fine", async () => {
    let now = T0;
    const store = new MemoryRateLimitStore(() => now);
    let refused = 0;
    for (let i = 0; i < RATE_LIMITS.postDaily.limit + 5; i++) {
      if (i % RATE_LIMITS.post.limit === 0) now += RATE_LIMITS.post.windowSeconds * 1000; // a fresh minute
      if (!(await checkLimits(store, ["post", "postDaily"], "u:a", now)).ok) refused++;
    }
    expect(refused).toBeGreaterThanOrEqual(5);
  });

  it("allows (and logs) when the store fails, so a Redis outage does not lock people out", async () => {
    const broken: RateLimitStore = { hit: () => Promise.reject(new Error("redis down")) };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkLimit(broken, "authVerify", "ip:x", T0)).ok).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("keeps the in-memory store bounded", async () => {
    const store = new MemoryRateLimitStore(() => T0, 100);
    for (let i = 0; i < 1000; i++) await store.hit(`k${i}`, 60);
    expect((store as unknown as { counts: Map<string, unknown> }).counts.size).toBeLessThanOrEqual(100);
  });

  it("every limit is positive and sane", () => {
    for (const [name, r] of Object.entries(RATE_LIMITS)) {
      expect(r.limit, name).toBeGreaterThan(0);
      expect(r.windowSeconds, name).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("client IP", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("prefers X-Real-IP (Railway's edge overwrites it)", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe("203.0.113.9");
  });
  it("falls back to the last X-Forwarded-For hop, never the caller-controlled first one", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }))).toBe("198.51.100.4");
  });
  it("is 'unknown' without headers", () => {
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("store selection", () => {
  it("uses Upstash Redis when configured and memory otherwise", () => {
    expect(defaultRateLimitStore({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeInstanceOf(RedisRateLimitStore);
    expect(defaultRateLimitStore({ NODE_ENV: "test" })).toBeInstanceOf(MemoryRateLimitStore);
  });
});

describe("wiring", () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it.each([
    ["src/app/api/auth/nonce/route.ts", 'limitIp("authNonce")'],
    ["src/app/api/auth/session/route.ts", 'limitIp("authVerify", "authVerifyHourly")'],
    ["src/app/api/auth/register/route.ts", 'limitIp("authVerify", "authVerifyHourly")'],
    ["src/app/api/auth/link/route.ts", 'limitIp("authVerify", "authVerifyHourly")'],
    ["src/app/api/graph/sign/route.ts", 'limitMember(user.id, "graphSign")'],
    ["src/app/actions.ts", 'limitMember(user.id, "post", "postDaily")'],
    ["src/app/actions.ts", 'limitMember(user.id, "intro", "introDaily")'],
    ["src/app/opportunity-actions.ts", 'limitMember(user.id, "intro", "introDaily")'],
    ["src/app/opportunity-actions.ts", 'limitMember(user.id, "report")'],
    ["src/app/onboarding-actions.ts", 'limitMember(user.id, "upload")'],
    ["src/app/import-actions.ts", 'limitMember(user.id, "import")'],
  ])("%s checks %s", (file, call) => {
    expect(src(file)).toContain(call);
  });

  it("429 responses carry Retry-After and a translated message", () => {
    const s = src("src/lib/rate-limit-server.ts");
    expect(s).toContain("status: 429");
    expect(s).toContain('"retry-after"');
    for (const k of ["rateLimit.tooMany", "rateLimit.tryIn", "rateLimit.tryInOne", "import.error.rate_limited", "onb.err.photo_rate_limited", "opps.introErr.rate_limited", "opps.reportErr.rate_limited", "composer.rateLimited"]) {
      expect(MESSAGES.en[k as keyof typeof MESSAGES.en], k).toBeTruthy();
      expect(MESSAGES.es[k as keyof typeof MESSAGES.es], k).toBeTruthy();
    }
  });
});

describe("rate limit keys", () => {
  it("are namespaced to Connect so one Upstash database can be shared with other EmpowerTours apps", async () => {
    const keys: string[] = [];
    const store: RateLimitStore = { hit: async (key) => (keys.push(key), 1) };
    await checkLimit(store, "post", "user-1", Date.UTC(2026, 9, 16));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^connect:rl:post:user-1:\d+$/);
  });
});
