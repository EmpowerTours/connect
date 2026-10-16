/**
 * Mera passkey auth: typed data, signature verification, nonce replay, session
 * tokens, cookies, the login/register/link flows, and the write-action guard.
 *
 * Signatures here come from a throwaway in-memory key (viem generatePrivateKey)
 * signing EIP-712 typed data OFF-CHAIN, standing in for the passkey-derived key.
 * Nothing is broadcast; there is no chain or RPC involved.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bytesToHex } from "viem";
import { APP_FULL_NAME, APP_HOST, APP_NAME, APP_URL, BRAND } from "@/lib/brand";
import { handleFromName } from "@/lib/auth-core";
import {
  ACCOUNT_PATH,
  EMPOWERTOURS_PRF_SALT,
  EMPOWERTOURS_PRF_SALT_LABEL,
  EMPOWERTOURS_RP_ID,
  assertOwnRelyingParty,
  isUsableCredentialId,
  walletFromPrfOutput,
} from "@/lib/mera/derive";
import { linkFlow, loginFlow, registerFlow, type AuthDeps, type AuthUserRef } from "@/lib/mera/flows";
import { shortAddress } from "@/lib/mera/format";
import {
  MERA_SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearSessionCookieHeader,
  issueSession,
  newNonce,
  readCookie,
  readSession,
  sessionCookieHeader,
} from "@/lib/mera/session";
import { APP_DOMAIN, LINK_STATEMENT, SESSION_STATEMENT, registrationTypedData, sessionTypedData } from "@/lib/mera/typed-data";
import {
  CLOCK_SKEW_SECONDS,
  MemoryNonceStore,
  defaultNonceStore,
  verifyRegistrationSignature,
  verifySessionSignature,
  type NonceStore,
} from "@/lib/mera/verify";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const now = () => Math.floor(Date.now() / 1000);

function newAccount() {
  return privateKeyToAccount(generatePrivateKey());
}

async function signedLogin(account = newAccount(), over: Partial<{ statement: string; clientTs: number; nonce: string; wallet: string }> = {}) {
  const clientTs = over.clientTs ?? now();
  const nonce = over.nonce ?? newNonce();
  const statement = over.statement ?? SESSION_STATEMENT;
  const signature = await account.signTypedData(sessionTypedData({ wallet: account.address, clientTs, nonce, statement }));
  return { account, body: { wallet: over.wallet ?? account.address, statement, clientTs, nonce, signature } };
}

async function signedRegistration(account = newAccount(), displayName = "Ana Ruiz", passkeyCredentialId = "AbCdEf0123456789_-xy") {
  const clientTs = now();
  const nonce = newNonce();
  const signature = await account.signTypedData(
    registrationTypedData({ wallet: account.address, displayName, passkeyCredentialId, clientTs, nonce }),
  );
  return { account, body: { wallet: account.address, displayName, passkeyCredentialId, clientTs, nonce, signature } };
}

beforeEach(() => {
  vi.stubEnv("AUTH_SESSION_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("brand config", () => {
  it("derives every user-facing name and the canonical URL from one constant", () => {
    expect(APP_NAME).toBe(BRAND.name);
    expect(APP_FULL_NAME).toBe(`EmpowerTours ${BRAND.name}`);
    expect(APP_HOST).toBe(`${BRAND.subdomain}.empowertours.xyz`);
    expect(APP_URL).toBe("https://connect.empowertours.xyz");
    expect(SESSION_STATEMENT).toContain(APP_FULL_NAME);
    expect(SESSION_STATEMENT).toMatch(/does not authorise a transaction/);
    expect(APP_DOMAIN).toEqual({ name: "EmpowerToursConnect", version: "1", chainId: 143 });
    expect(MERA_SESSION_COOKIE).toBe("connect_session");
  });
});

describe("passkey key derivation", () => {
  it("pins the shared EmpowerTours PRF salt to Hunt's exact bytes (changing it would orphan every wallet)", () => {
    expect(EMPOWERTOURS_PRF_SALT_LABEL).toBe("empowertours-hunt/passkey/v1");
    expect(EMPOWERTOURS_PRF_SALT).toHaveLength(32);
    // Same hex as Hunt's lib/auth/derive.test.ts and TURBO's derive.ts.
    expect(bytesToHex(EMPOWERTOURS_PRF_SALT)).toBe(PINNED_SALT_HEX);
  });

  it("uses the shared parent rpId and the standard first account", () => {
    expect(EMPOWERTOURS_RP_ID).toBe("empowertours.xyz");
    expect(ACCOUNT_PATH).toBe("m/44'/60'/0'/0/0");
  });

  it("maps 32 PRF bytes deterministically to an ordinary EVM account", () => {
    const prf = new Uint8Array(32).fill(7);
    const a = walletFromPrfOutput(prf);
    const b = walletFromPrfOutput(prf);
    expect(a.mnemonic.split(" ")).toHaveLength(24);
    expect(bytesToHex(a.privateKey)).toBe(bytesToHex(b.privateKey));
    expect(privateKeyToAccount(bytesToHex(a.privateKey)).address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(bytesToHex(walletFromPrfOutput(new Uint8Array(32).fill(8)).privateKey)).not.toBe(bytesToHex(a.privateKey));
  });

  it("refuses short PRF output", () => {
    expect(() => walletFromPrfOutput(new Uint8Array(16))).toThrow(/32 bytes/);
  });

  it("allows the shared parent rpId and local hosts, refuses per-host EmpowerTours rpIds", () => {
    expect(() => assertOwnRelyingParty("localhost")).not.toThrow();
    expect(() => assertOwnRelyingParty("empowertours.xyz")).not.toThrow();
    expect(() => assertOwnRelyingParty("EmpowerTours.xyz")).not.toThrow();
    expect(() => assertOwnRelyingParty("abc123.ngrok-free.app")).not.toThrow();
    // A per-host rpId mints a per-host credential, i.e. a DIFFERENT wallet from Hunt/TURBO.
    for (const host of ["connect.empowertours.xyz", "hunt.empowertours.xyz", "regalo.empowertours.xyz"]) {
      expect(() => assertOwnRelyingParty(host)).toThrow(/shared parent/);
    }
    // Under the parent rpId the salt must be the ecosystem one.
    expect(() => assertOwnRelyingParty("empowertours.xyz", "empowertours-connect/passkey/v1")).toThrow(/salt/);
    expect(() => assertOwnRelyingParty("empowertours.xyz", "empowertours-hunt/passkey/v1")).not.toThrow();
  });

  it("validates credential ids", () => {
    expect(isUsableCredentialId("AbCdEf0123456789_-xy")).toBe(true);
    expect(isUsableCredentialId("")).toBe(false);
    expect(isUsableCredentialId("has space")).toBe(false);
    expect(isUsableCredentialId("x".repeat(257))).toBe(false);
  });
});

describe("EIP-712 session verification", () => {
  it("accepts a valid signature and returns the lowercased signer", async () => {
    const { account, body } = await signedLogin();
    const r = await verifySessionSignature({ ...body, clientTs: BigInt(body.clientTs) }, { store: new MemoryNonceStore() });
    expect(r).toEqual({ ok: true, address: account.address.toLowerCase() });
  });

  it("rejects a replayed nonce", async () => {
    const store = new MemoryNonceStore();
    const { body } = await signedLogin();
    const p = { ...body, clientTs: BigInt(body.clientTs) };
    expect((await verifySessionSignature(p, { store })).ok).toBe(true);
    expect(await verifySessionSignature(p, { store })).toEqual({ ok: false, reason: "nonce_replayed" });
  });

  it("rejects a different statement (e.g. a link signature used to log in)", async () => {
    const { body } = await signedLogin(undefined, { statement: LINK_STATEMENT });
    expect(await verifySessionSignature({ ...body, clientTs: BigInt(body.clientTs) }, { store: new MemoryNonceStore() })).toEqual({ ok: false, reason: "malformed" });
    expect(
      (await verifySessionSignature({ ...body, clientTs: BigInt(body.clientTs) }, { store: new MemoryNonceStore(), expectedStatement: LINK_STATEMENT })).ok,
    ).toBe(true);
  });

  it("rejects a signature claiming someone else's wallet", async () => {
    const victim = newAccount();
    const { body } = await signedLogin(newAccount(), { wallet: victim.address });
    const r = await verifySessionSignature({ ...body, clientTs: BigInt(body.clientTs) }, { store: new MemoryNonceStore() });
    expect(r).toEqual({ ok: false, reason: "wrong_signer" });
  });

  it("rejects stale and future timestamps beyond the clock skew", async () => {
    for (const offset of [-(CLOCK_SKEW_SECONDS + 5), CLOCK_SKEW_SECONDS + 5]) {
      const { body } = await signedLogin(undefined, { clientTs: now() + offset });
      const r = await verifySessionSignature({ ...body, clientTs: BigInt(body.clientTs) }, { store: new MemoryNonceStore() });
      expect(r).toEqual({ ok: false, reason: "expired" });
    }
  });

  it("rejects malformed nonce and signature, and does not burn the nonce on a bad signature", async () => {
    const store = new MemoryNonceStore();
    const { body } = await signedLogin();
    const p = { ...body, clientTs: BigInt(body.clientTs) };
    expect(await verifySessionSignature({ ...p, nonce: "short" }, { store })).toEqual({ ok: false, reason: "malformed" });
    expect(await verifySessionSignature({ ...p, signature: "0x1234" }, { store })).toEqual({ ok: false, reason: "malformed" });
    const tampered = (p.signature.slice(0, 10) + (p.signature[10] === "a" ? "b" : "a") + p.signature.slice(11)) as `0x${string}`;
    const bad = await verifySessionSignature({ ...p, signature: tampered }, { store });
    expect(bad.ok).toBe(false);
    expect(store.size).toBe(0);
    expect((await verifySessionSignature(p, { store })).ok).toBe(true);
  });

  it("fails closed when the nonce store is down", async () => {
    const broken: NonceStore = { consume: async () => { throw new Error("down"); } };
    const { body } = await signedLogin();
    expect(await verifySessionSignature({ ...body, clientTs: BigInt(body.clientTs) }, { store: broken })).toEqual({ ok: false, reason: "nonce_store_unavailable" });
  });

  it("refuses the in-memory nonce store in production without Redis", () => {
    expect(() => defaultNonceStore({ NODE_ENV: "production" })).toThrow(/UPSTASH_REDIS_REST_URL/);
    expect(defaultNonceStore({ NODE_ENV: "development" })).toBeInstanceOf(MemoryNonceStore);
  });

  it("verifies registration signatures bound to name and credential id", async () => {
    const { account, body } = await signedRegistration();
    const p = { ...body, clientTs: BigInt(body.clientTs) };
    expect(await verifyRegistrationSignature({ ...p, displayName: "Someone Else" }, { store: new MemoryNonceStore() })).toEqual({ ok: false, reason: "wrong_signer" });
    expect(await verifyRegistrationSignature(p, { store: new MemoryNonceStore() })).toEqual({ ok: true, address: account.address.toLowerCase() });
  });
});

describe("session token", () => {
  const wallet = "0x" + "ab".repeat(20);

  it("round-trips wallet and credential id", () => {
    const r = readSession(issueSession(wallet, "cred_123"));
    expect(r).toEqual({ ok: true, wallet, credentialId: "cred_123" });
  });

  it("rejects tampered payloads and MACs", () => {
    const tok = issueSession(wallet);
    const [v, body, mac] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ w: "0x" + "cd".repeat(20), iat: now(), exp: now() + 999 })).toString("base64url");
    expect(readSession(`${v}.${forged}.${mac}`).ok).toBe(false);
    expect(readSession(`${v}.${body}.${mac.slice(0, -2)}AA`).ok).toBe(false);
    expect(readSession(`v2.${body}.${mac}`).ok).toBe(false);
    expect(readSession("").ok).toBe(false);
    expect(readSession(undefined).ok).toBe(false);
  });

  it("expires after the TTL", () => {
    const t0 = Date.now();
    const tok = issueSession(wallet, null, t0);
    expect(readSession(tok, t0 + (SESSION_TTL_SECONDS - 5) * 1000).ok).toBe(true);
    expect(readSession(tok, t0 + (SESSION_TTL_SECONDS + 5) * 1000)).toEqual({ ok: false, reason: "session expired" });
  });

  it("does not verify under a different secret", () => {
    const tok = issueSession(wallet);
    vi.stubEnv("AUTH_SESSION_SECRET", "another-secret-0123456789-abcdefghijk");
    expect(readSession(tok).ok).toBe(false);
  });

  it("fails closed with a missing or short secret", () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "");
    expect(() => issueSession(wallet)).toThrow(/AUTH_SESSION_SECRET/);
    vi.stubEnv("AUTH_SESSION_SECRET", "too-short");
    expect(() => issueSession(wallet)).toThrow(/AUTH_SESSION_SECRET/);
    expect(readSession("v1.e30.abc").ok).toBe(false);
  });

  it("refuses to mint for a non-address", () => {
    expect(() => issueSession("not-a-wallet")).toThrow();
  });
});

describe("cookies", () => {
  it("sets an HttpOnly, SameSite=Lax session cookie, Secure in production", () => {
    const h = sessionCookieHeader("tok");
    expect(h).toContain(`${MERA_SESSION_COOKIE}=tok`);
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Lax");
    expect(h).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(h).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieHeader("tok")).toContain("Secure");
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });

  it("reads one cookie from a request", () => {
    const req = new Request("http://x", { headers: { cookie: `a=1; ${MERA_SESSION_COOKIE}=v1.abc%2Edef; b=2` } });
    expect(readCookie(req, MERA_SESSION_COOKIE)).toBe("v1.abc.def");
    expect(readCookie(req, "missing")).toBeNull();
    expect(readCookie(new Request("http://x"), "a")).toBeNull();
  });
});

function fakeDeps(users: AuthUserRef[] = []): AuthDeps & { users: AuthUserRef[] } {
  return {
    users,
    verify: { store: new MemoryNonceStore() },
    findByWallet: async (w) => users.find((u) => u.walletAddress === w.toLowerCase()) ?? null,
    createWithWallet: async ({ wallet, displayName }) => {
      const u = { id: `u${users.length + 1}`, handle: handleFromName(displayName, new Set(users.map((x) => x.handle))), walletAddress: wallet };
      users.push(u);
      return u;
    },
    linkWallet: async ({ userId, wallet }) => {
      const u = users.find((x) => x.id === userId)!;
      u.walletAddress = wallet;
      return u;
    },
  };
}

describe("auth flows", () => {
  it("sign-up then sign-in: 404 for an unknown wallet, 201 on register, then 200", async () => {
    const deps = fakeDeps();
    const account = newAccount();
    const first = await loginFlow((await signedLogin(account)).body, deps);
    expect(first).toMatchObject({ ok: false, status: 404 });

    const reg = await registerFlow((await signedRegistration(account)).body, deps);
    expect(reg).toMatchObject({ ok: true, status: 201, wallet: account.address.toLowerCase() });
    expect(deps.users[0]).toMatchObject({ handle: "ana_ruiz", walletAddress: account.address.toLowerCase() });

    const again = await loginFlow((await signedLogin(account)).body, deps);
    expect(again).toMatchObject({ ok: true, status: 200, user: { handle: "ana_ruiz" } });
  });

  it("rejects bad payloads (400), bad signatures (401) and duplicate registration (409)", async () => {
    const deps = fakeDeps();
    expect(await loginFlow(null, deps)).toMatchObject({ status: 400 });
    expect(await loginFlow({ wallet: "0x1" }, deps)).toMatchObject({ status: 400 });
    const { body } = await signedLogin();
    expect(await loginFlow({ ...body, clientTs: body.clientTs - 1 }, deps)).toMatchObject({ status: 401 });

    const account = newAccount();
    expect((await registerFlow((await signedRegistration(account)).body, deps)).ok).toBe(true);
    expect(await registerFlow((await signedRegistration(account)).body, deps)).toMatchObject({ status: 409 });
  });

  it("links a wallet to the signed-in profile only with the link statement", async () => {
    const demo: AuthUserRef = { id: "demo", handle: "demo", walletAddress: null };
    const deps = fakeDeps([demo]);
    const account = newAccount();
    expect(await linkFlow((await signedLogin(account, { statement: LINK_STATEMENT })).body, null, deps)).toMatchObject({ status: 401 });
    expect(await linkFlow((await signedLogin(account)).body, demo, deps)).toMatchObject({ status: 400 });
    const ok = await linkFlow((await signedLogin(account, { statement: LINK_STATEMENT })).body, demo, deps);
    expect(ok).toMatchObject({ ok: true, user: { id: "demo" } });
    expect(demo.walletAddress).toBe(account.address.toLowerCase());
    // and now plain sign-in with that wallet resolves to the same profile
    expect(await loginFlow((await signedLogin(account)).body, deps)).toMatchObject({ ok: true, user: { id: "demo" } });
  });

  it("will not link a wallet already owned by another profile", async () => {
    const account = newAccount();
    const owner: AuthUserRef = { id: "a", handle: "a", walletAddress: account.address.toLowerCase() };
    const other: AuthUserRef = { id: "b", handle: "b", walletAddress: null };
    const deps = fakeDeps([owner, other]);
    expect(await linkFlow((await signedLogin(account, { statement: LINK_STATEMENT })).body, other, deps)).toMatchObject({ status: 409 });
  });
});

describe("write actions require a session", () => {
  const src = readFileSync(new URL("../src/app/actions.ts", import.meta.url), "utf8");
  const PUBLIC = new Set(["devLoginAction", "logoutAction", "setLocaleAction"]);
  // requireAdmin() is stricter than requireUser(): it redirects without a session, then 404s non-admins.
  const GUARDS = /requireUser\(\)|requireAdmin\(\)|ownedDeal\(|transitionIntro\(|moveDealAction\(/;

  it("every exported server action (except login/logout/locale) checks the session first", () => {
    const parts = src.split(/\nexport async function /).slice(1);
    expect(parts.length).toBeGreaterThan(20);
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("("));
      if (PUBLIC.has(name)) continue;
      expect(GUARDS.test(part.split(/\n}\n/)[0]), `${name} must call requireUser()`).toBe(true);
    }
  });

  it("there is no email magic-link sign-in left and no other wallet connector", () => {
    expect(src).not.toMatch(/MagicLink/);
    const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    expect(pkg).toContain("@category-labs/mera");
    expect(pkg).not.toMatch(/wagmi|walletconnect|rainbowkit|@metamask|web3modal|@reown/i);
  });
});

describe("helpers", () => {
  it("shortens addresses and derives handles from names", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(handleFromName("José Núñez", new Set())).toBe("jose_nunez");
    expect(handleFromName("José Núñez", new Set(["jose_nunez"]))).toBe("jose_nunez2");
    expect(handleFromName("!", new Set())).toBe("member");
  });
});

const PINNED_SALT_HEX = "0x9fc345cea9c77d56f4238d9940dfdc757b6a69fb1d83893e067cefbeda0f648f";
