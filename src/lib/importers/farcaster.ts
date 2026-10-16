/**
 * Farcaster importer: find the member's Farcaster account and the accounts it
 * follows, then match those to Connect profiles.
 *
 * Read-only, public data. Two providers behind one interface:
 *   - HubProvider: any Farcaster hub / Snapchain HTTP API (FARCASTER_HUB_URL,
 *     default a public hub). No key. A hub cannot look up an account by a
 *     *verified* address, only by custody address, so "find by wallet" may
 *     miss; the member can type their username instead.
 *   - NeynarProvider: Neynar's v2 REST API when NEYNAR_API_KEY is set. Finds
 *     accounts by custody or verified address.
 * Neither is required: without network access or keys the importer reports a
 * friendly error instead of failing the page. Tests inject a fake fetch.
 *
 * Time limits: every request is aborted after REQUEST_TIMEOUT_MS, and the
 * paginated follow walk stops after FOLLOW_BUDGET_MS. When the budget runs out
 * after at least one page, the walk returns what it has (`partial: true`);
 * before the first page it throws FarcasterUnavailable("timeout").
 */
import { logger } from "../log";

export type Fetcher = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface FarcasterAccount {
  fid: number;
  username: string;
  displayName: string;
  /** Lowercased custody + verified Ethereum addresses. */
  addresses: string[];
}

export interface FarcasterProvider {
  readonly name: "hub" | "neynar";
  /** Accounts that have one of these addresses as custody or (Neynar) verified address. */
  findByAddresses(addresses: string[]): Promise<FarcasterAccount[]>;
  findByUsername(username: string): Promise<FarcasterAccount | null>;
  /** Fids this account follows, up to `limit`. */
  following(fid: number, limit: number): Promise<number[]>;
  /** Same walk, and whether it stopped early because the time budget ran out. */
  followingWithStatus(fid: number, limit: number): Promise<FollowingResult>;
}

export interface FollowingResult {
  fids: number[];
  /** True when the time budget ran out before the list was complete. */
  partial: boolean;
}

export interface FarcasterTimeouts {
  /** Per request (hub or Neynar). Default REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number;
  /** Whole paginated follow walk. Default FOLLOW_BUDGET_MS. */
  followBudgetMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export class FarcasterUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FarcasterUnavailable";
  }
}

export const DEFAULT_HUB_URL = "https://haatz.quilibrium.com";
export const MAX_FOLLOWING = 1000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const FOLLOW_BUDGET_MS = 25_000;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const USERNAME = /^[a-z0-9][a-z0-9-]{0,15}(\.eth)?$/;

export function normalizeFarcasterUsername(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(warpcast\.com|farcaster\.xyz)\//, "").replace(/\/.*$/, "");
  return USERNAME.test(v) ? v : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url"; // Intentional: only used to label a log line.
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

async function getJson(fetcher: Fetcher, url: string, headers: Record<string, string> | undefined, timeoutMs: number): Promise<unknown> {
  const signal = AbortSignal.timeout(Math.max(1, timeoutMs));
  let res;
  let body: string;
  try {
    res = await fetcher(url, headers ? { headers, signal } : { signal });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 402 || res.status === 403) throw new FarcasterUnavailable("auth");
    if (!res.ok) throw new FarcasterUnavailable(`http_${res.status}`);
    body = (await res.text()).trim(); // the body read is covered by the same timeout
  } catch (e) {
    if (e instanceof FarcasterUnavailable) throw e;
    // Network failures are expected (public hub, flaky network) and reported to the member as
    // "unavailable"; the reason travels in the message. The host is logged, never the full URL.
    const reason = isAbort(e) || signal.aborted ? "timeout" : "network";
    logger.warn("farcaster request failed", { scope: "import.farcaster", host: hostOf(url), reason, err: e instanceof Error ? e.name : "unknown" });
    throw new FarcasterUnavailable(reason);
  }
  if (!body) return null; // some hubs answer "not found" with an empty 200
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new FarcasterUnavailable("bad_json");
  }
}

/** Shared time limits for both providers. */
class Limits {
  readonly requestTimeoutMs: number;
  readonly followBudgetMs: number;
  readonly now: () => number;
  constructor(t: FarcasterTimeouts = {}) {
    this.requestTimeoutMs = t.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.followBudgetMs = t.followBudgetMs ?? FOLLOW_BUDGET_MS;
    this.now = t.now ?? Date.now;
  }

  /**
   * Walk pages until `next` returns no cursor, `limit` fids are collected, 20 pages are read,
   * or the budget runs out. Each request gets the smaller of the per-request timeout and the
   * time left in the budget.
   */
  async walk(fid: number, limit: number, page: (cursor: string, timeoutMs: number) => Promise<{ fids: number[]; cursor: string }>): Promise<FollowingResult> {
    const deadline = this.now() + this.followBudgetMs;
    const out: number[] = [];
    let cursor = "";
    let partial = false;
    for (let n = 0; n < 20 && out.length < limit; n++) {
      const left = deadline - this.now();
      if (left <= 0) {
        if (n === 0) throw new FarcasterUnavailable("timeout");
        partial = true;
        break;
      }
      let res;
      try {
        res = await page(cursor, Math.min(this.requestTimeoutMs, left));
      } catch (e) {
        // A later page that timed out still leaves the earlier pages usable.
        if (n > 0 && e instanceof FarcasterUnavailable && e.message === "timeout") {
          partial = true;
          break;
        }
        throw e;
      }
      for (const f of res.fids) if (f !== fid) out.push(f);
      cursor = res.cursor;
      if (!cursor) break;
    }
    return { fids: [...new Set(out)].slice(0, limit), partial };
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* ---------- hub ---------- */

export class HubProvider implements FarcasterProvider {
  readonly name = "hub" as const;
  private readonly limits: Limits;
  constructor(private readonly fetcher: Fetcher, private readonly baseUrl: string = DEFAULT_HUB_URL, timeouts?: FarcasterTimeouts) {
    this.limits = new Limits(timeouts);
  }

  private get(url: string, timeoutMs = this.limits.requestTimeoutMs) {
    return getJson(this.fetcher, url, undefined, timeoutMs);
  }

  private url(path: string, q: Record<string, string | number>) {
    const u = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async account(fid: number, custody?: string): Promise<FarcasterAccount> {
    const [data, verifications] = await Promise.all([
      this.get(this.url("v1/userDataByFid", { fid })),
      this.get(this.url("v1/verificationsByFid", { fid })),
    ]);
    let username = "";
    let displayName = "";
    for (const m of arr(obj(data).messages)) {
      const body = obj(obj(obj(m).data).userDataBody);
      if (body.type === "USER_DATA_TYPE_USERNAME" && typeof body.value === "string") username = body.value;
      if (body.type === "USER_DATA_TYPE_DISPLAY" && typeof body.value === "string") displayName = body.value;
    }
    const addresses = new Set<string>(custody ? [custody.toLowerCase()] : []);
    for (const m of arr(obj(verifications).messages)) {
      const a = obj(obj(obj(m).data).verificationAddAddressBody).address;
      if (typeof a === "string" && ADDRESS.test(a.toLowerCase())) addresses.add(a.toLowerCase());
    }
    return { fid, username, displayName, addresses: [...addresses] };
  }

  async findByAddresses(addresses: string[]): Promise<FarcasterAccount[]> {
    const out: FarcasterAccount[] = [];
    for (const address of addresses.filter((a) => ADDRESS.test(a.toLowerCase()))) {
      const ev = obj(await this.get(this.url("v1/onChainIdRegistryEventByAddress", { address: address.toLowerCase() })));
      const fid = Number(obj(ev.idRegisterEventBody).fid ?? ev.fid);
      if (Number.isInteger(fid) && fid > 0) out.push(await this.account(fid, address));
    }
    return out;
  }

  async findByUsername(username: string): Promise<FarcasterAccount | null> {
    const name = normalizeFarcasterUsername(username);
    if (!name) return null;
    const proof = obj(await this.get(this.url("v1/userNameProofByName", { name })));
    const fid = Number(proof.fid);
    if (!Number.isInteger(fid) || fid <= 0) return null;
    const owner = typeof proof.owner === "string" ? proof.owner : undefined;
    const acc = await this.account(fid, owner && ADDRESS.test(owner.toLowerCase()) ? owner : undefined);
    return { ...acc, username: acc.username || name };
  }

  async following(fid: number, limit: number): Promise<number[]> {
    return (await this.followingWithStatus(fid, limit)).fids;
  }

  followingWithStatus(fid: number, limit: number): Promise<FollowingResult> {
    return this.limits.walk(fid, limit, async (pageToken, timeoutMs) => {
      const q: Record<string, string | number> = { fid, link_type: "follow", pageSize: 100 };
      if (pageToken) q.pageToken = pageToken;
      const res = obj(await this.get(this.url("v1/linksByFid", q), timeoutMs));
      const fids: number[] = [];
      for (const m of arr(res.messages)) {
        const target = Number(obj(obj(obj(m).data).linkBody).targetFid);
        if (Number.isInteger(target) && target > 0) fids.push(target);
      }
      return { fids, cursor: typeof res.nextPageToken === "string" ? res.nextPageToken : "" };
    });
  }
}

/* ---------- Neynar ---------- */

const NEYNAR = "https://api.neynar.com/v2/farcaster";

function neynarAccount(u: unknown): FarcasterAccount | null {
  const o = obj(u);
  const fid = Number(o.fid);
  if (!Number.isInteger(fid) || fid <= 0) return null;
  const addresses = new Set<string>();
  if (typeof o.custody_address === "string") addresses.add(o.custody_address.toLowerCase());
  for (const a of arr(obj(o.verified_addresses).eth_addresses)) if (typeof a === "string") addresses.add(a.toLowerCase());
  return {
    fid,
    username: typeof o.username === "string" ? o.username : "",
    displayName: typeof o.display_name === "string" ? o.display_name : "",
    addresses: [...addresses].filter((a) => ADDRESS.test(a)),
  };
}

export class NeynarProvider implements FarcasterProvider {
  readonly name = "neynar" as const;
  private readonly limits: Limits;
  constructor(private readonly fetcher: Fetcher, private readonly apiKey: string, timeouts?: FarcasterTimeouts) {
    this.limits = new Limits(timeouts);
  }
  private get(url: string, timeoutMs = this.limits.requestTimeoutMs) {
    return getJson(this.fetcher, url, { "x-api-key": this.apiKey, accept: "application/json" }, timeoutMs);
  }

  async findByAddresses(addresses: string[]): Promise<FarcasterAccount[]> {
    const list = addresses.map((a) => a.toLowerCase()).filter((a) => ADDRESS.test(a));
    if (!list.length) return [];
    const res = obj(await this.get(`${NEYNAR}/user/bulk-by-address?addresses=${list.join(",")}`));
    const out = new Map<number, FarcasterAccount>();
    for (const users of Object.values(res)) for (const u of arr(users)) {
      const acc = neynarAccount(u);
      if (acc) out.set(acc.fid, acc);
    }
    return [...out.values()];
  }

  async findByUsername(username: string): Promise<FarcasterAccount | null> {
    const name = normalizeFarcasterUsername(username);
    if (!name) return null;
    const res = obj(await this.get(`${NEYNAR}/user/by_username?username=${encodeURIComponent(name)}`));
    return neynarAccount(res.user);
  }

  async following(fid: number, limit: number): Promise<number[]> {
    return (await this.followingWithStatus(fid, limit)).fids;
  }

  followingWithStatus(fid: number, limit: number): Promise<FollowingResult> {
    return this.limits.walk(fid, limit, async (cursor, timeoutMs) => {
      const res = obj(await this.get(`${NEYNAR}/following?fid=${fid}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, timeoutMs));
      const fids: number[] = [];
      for (const row of arr(res.users)) {
        const acc = neynarAccount(obj(row).user ?? row);
        if (acc) fids.push(acc.fid);
      }
      const next = String(obj(res.next).cursor ?? "");
      return { fids, cursor: next === "null" ? "" : next };
    });
  }
}

/** Neynar when NEYNAR_API_KEY is set, otherwise the public hub (FARCASTER_HUB_URL). */
export function getFarcasterProvider(env: Record<string, string | undefined> = process.env, fetcher: Fetcher = globalThis.fetch as unknown as Fetcher): FarcasterProvider {
  if (env.NEYNAR_API_KEY) return new NeynarProvider(fetcher, env.NEYNAR_API_KEY);
  return new HubProvider(fetcher, env.FARCASTER_HUB_URL || DEFAULT_HUB_URL);
}

/** The member's account is verified when one of their own wallets is on it. */
export function isOwnAccount(account: FarcasterAccount, wallets: string[]): boolean {
  const mine = new Set(wallets.map((w) => w.toLowerCase()));
  return account.addresses.some((a) => mine.has(a));
}

/**
 * Connect profiles the member follows on Farcaster. Only profiles whose own
 * Farcaster link is verified count, so nobody can borrow someone else's fid.
 */
export function matchFarcasterFollowing(
  followingFids: number[],
  members: { id: string; farcasterFid: number | null; farcasterVerified: boolean; farcasterUsername: string }[],
): { userId: string; username: string }[] {
  const fids = new Set(followingFids);
  return members
    .filter((m) => m.farcasterVerified && m.farcasterFid !== null && fids.has(m.farcasterFid))
    .map((m) => ({ userId: m.id, username: m.farcasterUsername }));
}
