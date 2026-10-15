/**
 * Server-side verification of Mera passkey-wallet signatures. Mirrors Hunt's
 * lib/auth/eip712.ts (recoverAndCheck + nonce store), trimmed to the Session
 * and Registration types this app uses.
 *
 * Mera has no server SDK: a Mera account is an ordinary secp256k1 key derived
 * in the browser, so the server authenticates it the way it would any wallet —
 * by recovering the signer of an EIP-712 message it can bound in time and use
 * exactly once. Nothing here touches the chain.
 */
import { Redis } from "@upstash/redis";
import { isAddress, isHex, recoverTypedDataAddress, type Hex, type RecoverTypedDataAddressParameters } from "viem";
import { BRAND } from "../brand";
import { APP_DOMAIN, REGISTRATION_TYPES, SESSION_STATEMENT, SESSION_TYPES } from "./typed-data";

/** Accepted clock skew, seconds (same as Hunt). */
export const CLOCK_SKEW_SECONDS = 120;
/** Nonce records must outlive the whole ±skew acceptance window. */
export const NONCE_TTL_SECONDS = CLOCK_SKEW_SECONDS * 2;

export type VerifyFailure = "malformed" | "expired" | "bad_signature" | "wrong_signer" | "nonce_replayed" | "nonce_store_unavailable";
export type VerifyResult = { ok: true; address: string } | { ok: false; reason: VerifyFailure };

export interface SignedSession {
  wallet: string;
  statement: string;
  /** Unix SECONDS. */
  clientTs: bigint;
  nonce: string;
  signature: Hex;
}

export interface SignedRegistration {
  wallet: string;
  displayName: string;
  passkeyCredentialId: string;
  clientTs: bigint;
  nonce: string;
  signature: Hex;
}

export interface VerifyOptions {
  store?: NonceStore;
  now?: Date;
  env?: Record<string, string | undefined>;
}

// --- Nonce stores -----------------------------------------------------------

export interface NonceStore {
  /** Resolves true only if `key` was unused. MUST throw if the backend is down. */
  consume(key: string, ttlSeconds: number): Promise<boolean>;
}

export class MemoryNonceStore implements NonceStore {
  private readonly used = new Map<string, number>();
  constructor(private readonly maxEntries = 50_000) {}

  get size(): number {
    return this.used.size;
  }

  clear(): void {
    this.used.clear();
  }

  async consume(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.used.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    if (this.used.size >= this.maxEntries) {
      for (const [k, exp] of this.used) if (exp <= now) this.used.delete(k);
      while (this.used.size >= this.maxEntries) {
        const oldest = this.used.keys().next();
        if (oldest.done) break;
        this.used.delete(oldest.value);
      }
    }
    this.used.delete(key);
    this.used.set(key, now + ttlSeconds * 1000);
    return true;
  }
}

class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: Redis) {}
  async consume(key: string, ttlSeconds: number): Promise<boolean> {
    const written = await this.redis.set(key, 1, { nx: true, ex: ttlSeconds });
    return written === "OK";
  }
}

let redisClient: Redis | null | undefined;

/** Same env names as Hunt: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. */
function getRedis(env: Record<string, string | undefined>): Redis | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (env === process.env && redisClient !== undefined) return redisClient;
  const client = new Redis({ url, token });
  if (env === process.env) redisClient = client;
  return client;
}

const memoryNonceStore = new MemoryNonceStore();

/**
 * Redis when configured; otherwise the in-memory store — but never in
 * production, where two instances would each accept the same nonce once.
 */
export function defaultNonceStore(env: Record<string, string | undefined> = process.env): NonceStore {
  const redis = getRedis(env);
  if (redis) return new RedisNonceStore(redis);
  if (env.NODE_ENV === "production") {
    throw new Error("UPSTASH_REDIS_REST_URL is required in production: the in-memory nonce store cannot prevent replay across instances");
  }
  return memoryNonceStore;
}

/** Test seam. */
export function __resetMemoryNonceStore(): void {
  memoryNonceStore.clear();
}

// --- Verification -------------------------------------------------------------

export const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

function nonceKey(primaryType: string, address: string, nonce: string): string {
  return `${BRAND.subdomain}:nonce:${primaryType}:${address}:${nonce}`;
}

export function timestampOk(clientTs: bigint, now: Date): boolean {
  if (clientTs <= BigInt(0) || clientTs > BigInt(100_000_000_000)) return false;
  const delta = Math.abs(Math.floor(now.getTime() / 1000) - Number(clientTs));
  return delta <= CLOCK_SKEW_SECONDS;
}

async function recoverAndCheck(args: {
  primaryType: string;
  typedData: RecoverTypedDataAddressParameters;
  signature: Hex;
  nonce: string;
  clientTs: bigint;
  expectedAddress: string;
  opts?: VerifyOptions;
}): Promise<VerifyResult> {
  const now = args.opts?.now ?? new Date();
  if (!isHex(args.signature) || args.signature.length < 132) return { ok: false, reason: "malformed" };
  if (!NONCE_RE.test(args.nonce)) return { ok: false, reason: "malformed" };
  if (!isAddress(args.expectedAddress, { strict: false })) return { ok: false, reason: "malformed" };
  if (!timestampOk(args.clientTs, now)) return { ok: false, reason: "expired" };

  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress(args.typedData);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  const address = recovered.toLowerCase();
  if (address !== args.expectedAddress.toLowerCase()) return { ok: false, reason: "wrong_signer" };

  // The nonce is spent only AFTER the signature checks out, so garbage
  // requests cannot burn someone else's nonce.
  let store: NonceStore;
  try {
    store = args.opts?.store ?? defaultNonceStore(args.opts?.env);
  } catch {
    return { ok: false, reason: "nonce_store_unavailable" };
  }
  let fresh: boolean;
  try {
    fresh = await store.consume(nonceKey(args.primaryType, address, args.nonce), NONCE_TTL_SECONDS);
  } catch {
    return { ok: false, reason: "nonce_store_unavailable" };
  }
  if (!fresh) return { ok: false, reason: "nonce_replayed" };
  return { ok: true, address };
}

/**
 * Verify a login (or, with `expectedStatement: LINK_STATEMENT`, a wallet-link)
 * signature. The statement is pinned: a signature over any other text fails.
 */
export function verifySessionSignature(
  payload: SignedSession,
  opts?: VerifyOptions & { expectedStatement?: string },
): Promise<VerifyResult> {
  if (payload.statement !== (opts?.expectedStatement ?? SESSION_STATEMENT)) {
    return Promise.resolve({ ok: false, reason: "malformed" });
  }
  return recoverAndCheck({
    primaryType: "Session",
    typedData: {
      domain: APP_DOMAIN,
      types: SESSION_TYPES,
      primaryType: "Session",
      message: { wallet: payload.wallet, statement: payload.statement, clientTs: payload.clientTs, nonce: payload.nonce },
      signature: payload.signature,
    },
    signature: payload.signature,
    nonce: payload.nonce,
    clientTs: payload.clientTs,
    expectedAddress: payload.wallet,
    opts,
  });
}

/** Sign-up: the recovered address must equal the wallet being registered. */
export function verifyRegistrationSignature(payload: SignedRegistration, opts?: VerifyOptions): Promise<VerifyResult> {
  return recoverAndCheck({
    primaryType: "Registration",
    typedData: {
      domain: APP_DOMAIN,
      types: REGISTRATION_TYPES,
      primaryType: "Registration",
      message: {
        wallet: payload.wallet,
        displayName: payload.displayName,
        passkeyCredentialId: payload.passkeyCredentialId,
        clientTs: payload.clientTs,
        nonce: payload.nonce,
      },
      signature: payload.signature,
    },
    signature: payload.signature,
    nonce: payload.nonce,
    clientTs: payload.clientTs,
    expectedAddress: payload.wallet,
    opts,
  });
}
