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
 */
export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

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
}

export class FarcasterUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FarcasterUnavailable";
  }
}

export const DEFAULT_HUB_URL = "https://haatz.quilibrium.com";
export const MAX_FOLLOWING = 1000;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const USERNAME = /^[a-z0-9][a-z0-9-]{0,15}(\.eth)?$/;

export function normalizeFarcasterUsername(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(warpcast\.com|farcaster\.xyz)\//, "").replace(/\/.*$/, "");
  return USERNAME.test(v) ? v : null;
}

async function getJson(fetcher: Fetcher, url: string, headers?: Record<string, string>): Promise<unknown> {
  let res;
  try {
    res = await fetcher(url, headers ? { headers } : undefined);
  } catch {
    throw new FarcasterUnavailable("network");
  }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 402 || res.status === 403) throw new FarcasterUnavailable("auth");
  if (!res.ok) throw new FarcasterUnavailable(`http_${res.status}`);
  const body = (await res.text()).trim();
  if (!body) return null; // some hubs answer "not found" with an empty 200
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new FarcasterUnavailable("bad_json");
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* ---------- hub ---------- */

export class HubProvider implements FarcasterProvider {
  readonly name = "hub" as const;
  constructor(private readonly fetcher: Fetcher, private readonly baseUrl: string = DEFAULT_HUB_URL) {}

  private url(path: string, q: Record<string, string | number>) {
    const u = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async account(fid: number, custody?: string): Promise<FarcasterAccount> {
    const [data, verifications] = await Promise.all([
      getJson(this.fetcher, this.url("v1/userDataByFid", { fid })),
      getJson(this.fetcher, this.url("v1/verificationsByFid", { fid })),
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
      const ev = obj(await getJson(this.fetcher, this.url("v1/onChainIdRegistryEventByAddress", { address: address.toLowerCase() })));
      const fid = Number(obj(ev.idRegisterEventBody).fid ?? ev.fid);
      if (Number.isInteger(fid) && fid > 0) out.push(await this.account(fid, address));
    }
    return out;
  }

  async findByUsername(username: string): Promise<FarcasterAccount | null> {
    const name = normalizeFarcasterUsername(username);
    if (!name) return null;
    const proof = obj(await getJson(this.fetcher, this.url("v1/userNameProofByName", { name })));
    const fid = Number(proof.fid);
    if (!Number.isInteger(fid) || fid <= 0) return null;
    const owner = typeof proof.owner === "string" ? proof.owner : undefined;
    const acc = await this.account(fid, owner && ADDRESS.test(owner.toLowerCase()) ? owner : undefined);
    return { ...acc, username: acc.username || name };
  }

  async following(fid: number, limit: number): Promise<number[]> {
    const out: number[] = [];
    let pageToken = "";
    for (let page = 0; page < 20 && out.length < limit; page++) {
      const q: Record<string, string | number> = { fid, link_type: "follow", pageSize: 100 };
      if (pageToken) q.pageToken = pageToken;
      const res = obj(await getJson(this.fetcher, this.url("v1/linksByFid", q)));
      for (const m of arr(res.messages)) {
        const target = Number(obj(obj(obj(m).data).linkBody).targetFid);
        if (Number.isInteger(target) && target > 0 && target !== fid) out.push(target);
      }
      pageToken = typeof res.nextPageToken === "string" ? res.nextPageToken : "";
      if (!pageToken) break;
    }
    return [...new Set(out)].slice(0, limit);
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
  constructor(private readonly fetcher: Fetcher, private readonly apiKey: string) {}
  private get headers() {
    return { "x-api-key": this.apiKey, accept: "application/json" };
  }

  async findByAddresses(addresses: string[]): Promise<FarcasterAccount[]> {
    const list = addresses.map((a) => a.toLowerCase()).filter((a) => ADDRESS.test(a));
    if (!list.length) return [];
    const res = obj(await getJson(this.fetcher, `${NEYNAR}/user/bulk-by-address?addresses=${list.join(",")}`, this.headers));
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
    const res = obj(await getJson(this.fetcher, `${NEYNAR}/user/by_username?username=${encodeURIComponent(name)}`, this.headers));
    return neynarAccount(res.user);
  }

  async following(fid: number, limit: number): Promise<number[]> {
    const out: number[] = [];
    let cursor = "";
    for (let page = 0; page < 20 && out.length < limit; page++) {
      const res = obj(await getJson(this.fetcher, `${NEYNAR}/following?fid=${fid}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, this.headers));
      for (const row of arr(res.users)) {
        const acc = neynarAccount(obj(row).user ?? row);
        if (acc) out.push(acc.fid);
      }
      cursor = String(obj(res.next).cursor ?? "");
      if (!cursor || cursor === "null") break;
    }
    return [...new Set(out)].slice(0, limit);
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
