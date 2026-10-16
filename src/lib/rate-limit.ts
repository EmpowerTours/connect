/**
 * Fixed-window rate limits. Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (shared
 * across instances); an in-memory store otherwise (dev, tests, a single instance).
 *
 * Who is counted: the signed-in member for member actions, the client IP for sign-in.
 * On Railway the client IP is X-Real-IP: the public edge overwrites it on every request,
 * so callers cannot forge it (https://docs.railway.com/networking/public-networking/specs-and-limits).
 *
 * If Redis errors, the request is allowed and the error logged: a Redis outage should not
 * lock everyone out. Replay protection (nonces) fails closed separately.
 */
import { Redis } from "@upstash/redis";

export interface LimitRule {
  limit: number;
  windowSeconds: number;
}

/** Sensible defaults for a small professional network; generous for people, tight for scripts. */
export const RATE_LIMITS = {
  /** GET /api/auth/nonce, per IP. */
  authNonce: { limit: 30, windowSeconds: 60 },
  /** Sign in, sign up, link a wallet (signature checks), per IP. */
  authVerify: { limit: 10, windowSeconds: 60 },
  authVerifyHourly: { limit: 60, windowSeconds: 3600 },
  /** Posts and replies, per member. */
  post: { limit: 8, windowSeconds: 60 },
  postDaily: { limit: 150, windowSeconds: 86_400 },
  /** Reports, per member. */
  report: { limit: 10, windowSeconds: 3600 },
  /** Intro requests (warm drafts and direct requests), per member. */
  intro: { limit: 10, windowSeconds: 3600 },
  introDaily: { limit: 30, windowSeconds: 86_400 },
  /** Profile photo uploads, per member. */
  upload: { limit: 10, windowSeconds: 3600 },
  /** Farcaster, X and wallet imports together, per member (each calls out to a hub, parser or RPC). */
  import: { limit: 12, windowSeconds: 3600 },
  /** Signed graph batches, per member (each batch holds up to 200 updates). */
  graphSign: { limit: 30, windowSeconds: 3600 },
} as const satisfies Record<string, LimitRule>;

export type LimitName = keyof typeof RATE_LIMITS;

export interface LimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (0 when ok and nothing to wait for). */
  retryAfter: number;
}

export interface RateLimitStore {
  /** Count one hit in the window that `windowStart` identifies; returns the count so far. */
  hit(key: string, windowSeconds: number): Promise<number>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, { count: number; expiresAt: number }>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 50_000,
  ) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const now = this.now();
    const cur = this.counts.get(key);
    if (cur && cur.expiresAt > now) {
      cur.count += 1;
      return cur.count;
    }
    if (this.counts.size >= this.maxEntries) {
      for (const [k, v] of this.counts) if (v.expiresAt <= now) this.counts.delete(k);
      while (this.counts.size >= this.maxEntries) {
        const oldest = this.counts.keys().next();
        if (oldest.done) break;
        this.counts.delete(oldest.value);
      }
    }
    this.counts.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return 1;
  }

  clear(): void {
    this.counts.clear();
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}
  async hit(key: string, windowSeconds: number): Promise<number> {
    const [count] = await this.redis.pipeline().incr(key).expire(key, windowSeconds, "NX").exec<[number, number]>();
    return count;
  }
}

/** Fixed window: the key carries the window number, so it expires on its own. */
export async function checkLimit(
  store: RateLimitStore,
  name: LimitName,
  subject: string,
  now: number = Date.now(),
): Promise<LimitResult> {
  const rule = RATE_LIMITS[name];
  const windowMs = rule.windowSeconds * 1000;
  const window = Math.floor(now / windowMs);
  const retryAfter = Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000));
  let count: number;
  try {
    count = await store.hit(`rl:${name}:${subject}:${window}`, rule.windowSeconds);
  } catch (e) {
    console.error(`[rate-limit] ${name} store failed; allowing`, e);
    return { ok: true, limit: rule.limit, remaining: rule.limit, retryAfter: 0 };
  }
  const ok = count <= rule.limit;
  return { ok, limit: rule.limit, remaining: Math.max(0, rule.limit - count), retryAfter: ok ? 0 : retryAfter };
}

/** Check several rules for one subject (e.g. per-minute and per-day); the first one exceeded wins. */
export async function checkLimits(store: RateLimitStore, names: LimitName[], subject: string, now: number = Date.now()): Promise<LimitResult> {
  let last: LimitResult | null = null;
  for (const name of names) {
    const r = await checkLimit(store, name, subject, now);
    if (!r.ok) return r;
    last = r;
  }
  return last ?? { ok: true, limit: 0, remaining: 0, retryAfter: 0 };
}

/** The caller's IP: X-Real-IP (set by Railway's edge), then the last X-Forwarded-For hop, else "unknown". */
export function clientIp(headers: Pick<Headers, "get">): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for");
  const last = fwd?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || "unknown";
}

let redisStore: RedisRateLimitStore | null | undefined;
const memoryStore = new MemoryRateLimitStore();
let warned = false;

export function defaultRateLimitStore(env: Record<string, string | undefined> = process.env): RateLimitStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    if (env !== process.env) return new RedisRateLimitStore(new Redis({ url, token }));
    redisStore ??= new RedisRateLimitStore(new Redis({ url, token }));
    return redisStore;
  }
  if (env.NODE_ENV === "production" && !warned) {
    warned = true;
    console.warn("[rate-limit] UPSTASH_REDIS_REST_URL not set: limits are per instance (in memory)");
  }
  return memoryStore;
}

/** Test seam. */
export function __resetMemoryRateLimits(): void {
  memoryStore.clear();
}
