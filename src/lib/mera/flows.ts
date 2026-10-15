/**
 * The auth route logic, with the database injected so it is unit-testable.
 * The route handlers in src/app/api/auth/* are thin wrappers around these.
 *
 *   login    POST /api/auth/session   Session signature  -> 200 | 404 (no profile yet) | 401
 *   register POST /api/auth/register  Registration sig   -> 201 (profile created, wallet linked)
 *   link     POST /api/auth/link      Session sig with LINK_STATEMENT, while signed in
 *                                     (e.g. the local demo user) -> wallet linked to that profile
 */
import { z } from "zod";
import { LINK_STATEMENT, SESSION_STATEMENT } from "./typed-data";
import { LoginInput, RegisterInput } from "./inputs";
import { verifyRegistrationSignature, verifySessionSignature, type VerifyOptions } from "./verify";

export interface AuthUserRef {
  id: string;
  handle: string;
  walletAddress: string | null;
}

export interface AuthDeps {
  findByWallet(wallet: string): Promise<AuthUserRef | null>;
  createWithWallet(args: { wallet: string; displayName: string; credentialId: string }): Promise<AuthUserRef>;
  linkWallet(args: { userId: string; wallet: string; credentialId: string | null }): Promise<AuthUserRef>;
  verify?: VerifyOptions;
}

export type FlowResult =
  | { ok: true; status: 200 | 201; user: AuthUserRef; wallet: string; credentialId: string | null }
  | { ok: false; status: 400 | 401 | 404 | 409; error: string };

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> | null {
  const r = schema.safeParse(body);
  return r.success ? r.data : null;
}

export async function loginFlow(body: unknown, deps: AuthDeps): Promise<FlowResult> {
  const input = parse(LoginInput, body);
  if (!input || input.statement !== SESSION_STATEMENT) return { ok: false, status: 400, error: "invalid payload" };
  const v = await verifySessionSignature(input, deps.verify);
  if (!v.ok) return { ok: false, status: 401, error: "invalid signature" };
  const user = await deps.findByWallet(v.address);
  if (!user) return { ok: false, status: 404, error: "no profile for this wallet yet" };
  return { ok: true, status: 200, user, wallet: v.address, credentialId: input.passkeyCredentialId ?? null };
}

export async function registerFlow(body: unknown, deps: AuthDeps): Promise<FlowResult> {
  const input = parse(RegisterInput, body);
  if (!input) return { ok: false, status: 400, error: "invalid payload" };
  const v = await verifyRegistrationSignature(input, deps.verify);
  if (!v.ok) return { ok: false, status: 401, error: "invalid signature" };
  const existing = await deps.findByWallet(v.address);
  if (existing) return { ok: false, status: 409, error: "this wallet already has a profile — sign in instead" };
  const user = await deps.createWithWallet({ wallet: v.address, displayName: input.displayName, credentialId: input.passkeyCredentialId });
  return { ok: true, status: 201, user, wallet: v.address, credentialId: input.passkeyCredentialId };
}

export async function linkFlow(body: unknown, current: AuthUserRef | null, deps: AuthDeps): Promise<FlowResult> {
  if (!current) return { ok: false, status: 401, error: "sign in first" };
  const input = parse(LoginInput, body);
  if (!input || input.statement !== LINK_STATEMENT) return { ok: false, status: 400, error: "invalid payload" };
  const v = await verifySessionSignature(input, { ...deps.verify, expectedStatement: LINK_STATEMENT });
  if (!v.ok) return { ok: false, status: 401, error: "invalid signature" };
  if (current.walletAddress && current.walletAddress !== v.address) {
    return { ok: false, status: 409, error: "this profile is already linked to a different wallet" };
  }
  const owner = await deps.findByWallet(v.address);
  if (owner && owner.id !== current.id) return { ok: false, status: 409, error: "this wallet is linked to another profile" };
  const user = await deps.linkWallet({ userId: current.id, wallet: v.address, credentialId: input.passkeyCredentialId ?? null });
  return { ok: true, status: 200, user, wallet: v.address, credentialId: input.passkeyCredentialId ?? null };
}
