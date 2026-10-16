"use client";
/**
 * Browser half of Mera passkey sign-in. Mirrors Hunt's lib/auth/passkey.ts +
 * lib/auth/signIn.ts:
 *
 *   1. WebAuthn ceremony (Mera) -> 32 PRF bytes for (credential, rpId, EMPOWERTOURS_PRF_SALT)
 *      Same rpId (empowertours.xyz) and salt as Hunt and TURBO, so the same
 *      passkey is the same wallet in every EmpowerTours app.
 *   2. PRF -> BIP-39 -> m/44'/60'/0'/0/0 secp256k1 key -> Mera signing session
 *   3. sign an EIP-712 Session message (off-chain; NOT a transaction)
 *   4. POST /api/auth/session -> HttpOnly session cookie
 *      404 => first visit: sign a Registration message, POST /api/auth/register
 *
 * Mera only. There is deliberately no injected-wallet (window.ethereum),
 * WalletConnect or any other connector anywhere in this app.
 */
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";
import { APP_FULL_NAME, BRAND } from "../brand";
import { EMPOWERTOURS_PRF_SALT, assertOwnRelyingParty, isUsableCredentialId, walletFromPrfOutput } from "./derive";
import { LINK_STATEMENT, SESSION_STATEMENT, registrationTypedData, sessionTypedData } from "./typed-data";
import { graphTypedData, isGraphAction, type GraphMessage } from "../graph/typed-data";

/** Same env name as Hunt. "localhost" for local dev. */
export const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost";

const CEREMONY_TIMEOUT_MS = 60_000;
const HARD_GUARD_MS = CEREMONY_TIMEOUT_MS + 15_000;
const CREDENTIAL_KEY = `${BRAND.subdomain}.passkey.credential`;
/** Shared across EmpowerTours subdomains (same name as Hunt) so one passkey is found everywhere. */
const CREDENTIAL_COOKIE = "et.passkey.credential";

class CeremonyTimeout extends Error {
  constructor() {
    super("ceremony timed out");
    this.name = "CeremonyTimeout";
  }
}

async function withGuard<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CeremonyTimeout()), HARD_GUARD_MS);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function cookieDomain(): string | null {
  const id = RP_ID.toLowerCase();
  return !id.includes(".") || id === "localhost" ? null : id;
}

function asCredential(v: unknown): PasskeyCredentialMetadata | undefined {
  if (typeof v === "object" && v !== null && "credentialId" in v && isUsableCredentialId((v as { credentialId: unknown }).credentialId)) {
    return v as PasskeyCredentialMetadata;
  }
  return undefined;
}

function storedCredential(): PasskeyCredentialMetadata | undefined {
  try {
    const raw = localStorage.getItem(CREDENTIAL_KEY);
    const local = raw ? asCredential(JSON.parse(raw)) : undefined;
    if (local) return local;
  } catch {
    /* storage unavailable */
  }
  try {
    const match = document.cookie.split("; ").find((c) => c.startsWith(`${CREDENTIAL_COOKIE}=`));
    return match ? asCredential(JSON.parse(decodeURIComponent(match.slice(CREDENTIAL_COOKIE.length + 1)))) : undefined;
  } catch {
    return undefined;
  }
}

function rememberCredential(c: PasskeyCredentialMetadata): void {
  const meta = { credentialId: c.credentialId, transports: c.transports };
  try {
    localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
  const domain = cookieDomain();
  if (domain) {
    document.cookie = `${CREDENTIAL_COOKIE}=${encodeURIComponent(JSON.stringify(meta))}; domain=${domain}; path=/; max-age=34560000; secure; samesite=lax`;
  }
}

function forgetCredential(): void {
  try {
    localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    /* ignore */
  }
  // Clear the shared cookie too (as Hunt does), or a stale id outlives the reset.
  const domain = cookieDomain();
  if (domain) {
    try {
      document.cookie = `${CREDENTIAL_COOKIE}=; domain=${domain}; path=/; max-age=0; secure; samesite=lax`;
    } catch {
      /* ignore */
    }
  }
}

export interface PasskeyAccount {
  account: LocalAccount;
  session: Secp256k1SigningSession;
  credentialId: string;
}

function accountFromPrfOutput(prfOutput: Uint8Array, credentialId: string): PasskeyAccount {
  const { privateKey } = walletFromPrfOutput(prfOutput);
  const session = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  const account = toViemAccount(session);
  if (getEvmAddress(session.publicKey).toLowerCase() !== account.address.toLowerCase()) {
    session.end();
    throw new Error("address mismatch between mera and viem");
  }
  return { account, session, credentialId };
}

/** Sign up: a brand-new passkey (and therefore a brand-new wallet). */
async function createAccount(displayName: string): Promise<PasskeyAccount> {
  assertOwnRelyingParty(RP_ID);
  const created = await withGuard(
    createPasskeyWithPrfOutput({
      rp: { id: RP_ID, name: APP_FULL_NAME },
      user: { name: displayName, displayName },
      prfSalt: EMPOWERTOURS_PRF_SALT,
      timeout: CEREMONY_TIMEOUT_MS,
    }),
  );
  rememberCredential(created);
  return accountFromPrfOutput(created.prfOutput, created.credentialId);
}

/** Sign in: an existing passkey. */
async function signInAccount(): Promise<PasskeyAccount> {
  assertOwnRelyingParty(RP_ID);
  const known = storedCredential();
  const lookup = (credential: PasskeyCredentialMetadata | undefined) =>
    withGuard(getPasskeyPrfOutput({ rpId: RP_ID, credential, prfSalt: EMPOWERTOURS_PRF_SALT, timeout: CEREMONY_TIMEOUT_MS }));
  let out: { prfOutput: Uint8Array; credentialId: string };
  try {
    out = await lookup(known);
  } catch (err) {
    if (known === undefined || !isMeraError(err) || err.code !== "INPUT_INVALID") throw err;
    forgetCredential();
    out = await lookup(undefined);
  }
  rememberCredential(known?.credentialId === out.credentialId ? known : { credentialId: out.credentialId });
  return accountFromPrfOutput(out.prfOutput, out.credentialId);
}

function clientNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function freshNonce(): Promise<{ nonce: string; ts: number }> {
  try {
    const res = await fetch("/api/auth/nonce", { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as { nonce?: unknown; serverTs?: unknown };
      if (typeof body.nonce === "string" && typeof body.serverTs === "number") return { nonce: body.nonce, ts: body.serverTs };
    }
  } catch {
    /* fall through */
  }
  return { nonce: clientNonce(), ts: Math.floor(Date.now() / 1000) };
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* ignore */
  }
  return fallback;
}

async function postJson(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function signSession(p: PasskeyAccount, statement: string) {
  const { nonce, ts } = await freshNonce();
  const wallet = p.account.address;
  const signature = await p.account.signTypedData(sessionTypedData({ wallet, clientTs: ts, nonce, statement }));
  return { wallet, statement, clientTs: ts, nonce, signature, passkeyCredentialId: p.credentialId };
}

async function establishSession(p: PasskeyAccount, displayName: string): Promise<void> {
  const login = await postJson("/api/auth/session", await signSession(p, SESSION_STATEMENT));
  if (login.ok) return;
  if (login.status !== 404) throw new Error(await errorFrom(login, "Could not sign in."));

  // First time this wallet is seen: sign up.
  const { nonce, ts } = await freshNonce();
  const wallet = p.account.address;
  const name = displayName.trim() || "New member";
  const signature = await p.account.signTypedData(
    registrationTypedData({ wallet, displayName: name, passkeyCredentialId: p.credentialId, clientTs: ts, nonce }),
  );
  const reg = await postJson("/api/auth/register", { wallet, displayName: name, passkeyCredentialId: p.credentialId, clientTs: ts, nonce, signature });
  if (!reg.ok) throw new Error(await errorFrom(reg, "Could not create your profile."));
}

async function withAccount(get: () => Promise<PasskeyAccount>, work: (p: PasskeyAccount) => Promise<void>) {
  const p = await get();
  try {
    await work(p);
  } finally {
    p.session.end(); // zero the key material
  }
}

/** "Sign in with passkey". New wallet => creates the profile too. */
export function signInWithPasskey(displayName = ""): Promise<void> {
  return withAccount(signInAccount, (p) => establishSession(p, displayName));
}

/** "Create a passkey wallet" (sign-up). */
export function createWalletWithPasskey(displayName: string): Promise<void> {
  return withAccount(() => createAccount(displayName || `${BRAND.name} member`), (p) => establishSession(p, displayName));
}

/** Link a Mera wallet to the profile you are signed in with (e.g. the demo user). */
export function linkWalletWithPasskey(mode: "existing" | "new", displayName: string): Promise<void> {
  return withAccount(mode === "new" ? () => createAccount(displayName) : signInAccount, async (p) => {
    const res = await postJson("/api/auth/link", await signSession(p, LINK_STATEMENT));
    if (!res.ok) throw new Error(await errorFrom(res, "Could not link this wallet."));
  });
}

/**
 * Sign the member's pending graph updates with one passkey prompt. The typed
 * data is rebuilt here from the app's own constants (domain, types, pinned
 * statement); the server only supplies the fields, and every one must name
 * this wallet as author. Off-chain signatures only: nothing is sent to Monad.
 */
export async function signGraphUpdates(): Promise<number> {
  let stored = 0;
  await withAccount(signInAccount, async (p) => {
    const res = await fetch("/api/graph/pending", { cache: "no-store" });
    if (!res.ok) throw new Error(await errorFrom(res, "Could not load your pending updates."));
    const body = (await res.json()) as { wallet?: string; messages?: GraphMessage[] };
    const mine = p.account.address.toLowerCase();
    if (body.wallet?.toLowerCase() !== mine) throw new Error("This passkey opens a different wallet than the one on your profile.");
    const messages = body.messages ?? [];
    if (!messages.length) return;
    const items = [];
    for (const m of messages) {
      if (m.author.toLowerCase() !== mine || !isGraphAction(m.action)) throw new Error("Refusing to sign an update that is not yours.");
      items.push({ message: m, signature: await p.account.signTypedData(graphTypedData(m)) });
    }
    const post = await postJson("/api/graph/sign", { items });
    if (!post.ok) throw new Error(await errorFrom(post, "Could not publish your updates."));
    stored = items.length;
  });
  return stored;
}

export function explainPasskeyError(err: unknown): string {
  if (err instanceof CeremonyTimeout) return "Nothing answered the passkey request. Try again on the device that holds your passkey.";
  if (isMeraError(err)) {
    switch (err.code) {
      case "PRF_UNAVAILABLE":
        return "This device or password manager can't create a Mera wallet (it needs WebAuthn PRF). Try Safari with iCloud Keychain, Chrome with Google Password Manager, or 1Password.";
      case "PASSKEY_OPERATION_FAILED":
        return "The passkey prompt was cancelled or unavailable. Try again.";
      case "CRYPTO_UNAVAILABLE":
        return "Passkeys need HTTPS (or localhost).";
      default:
        return `Passkey error (${err.code}).`;
    }
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
