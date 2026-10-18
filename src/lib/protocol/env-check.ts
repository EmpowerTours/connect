/**
 * Feature flags and boot-time configuration checks for the protocol wiring. Names and reasons
 * only, never values.
 *
 *   Web app (src/lib/env.ts):  PROTOCOL_ENABLED, PROTOCOL_CHAIN_ID, PROTOCOL_RPC_URL,
 *                              PROTOCOL_DEPLOYMENT_FILE, and for sponsorship RELAYER_URL +
 *                              RELAYER_SERVICE_TOKEN. The web app never holds the relayer key.
 *   Relayer service (relayer/server.ts): the same PROTOCOL_* values, RELAYER_SERVICE_TOKEN,
 *                              RELAYER_KEY or RELAYER_KEY_FILE, DATABASE_URL, RELAYER_* limits.
 */
import { PROTOCOL_CHAINS, protocolChainId, protocolRpcUrl } from "./chains";
import { loadDeployment, type ProtocolDeployment } from "./deployments";
import { loadRelayerAccount, type KeyFs } from "./relayer/key";
import { relayerLimitsFromEnv } from "./relayer/policy";

type Env = Record<string, string | undefined>;
type Report = { errors: string[]; warnings: string[] };
type Opts = { read?: (file: string) => string; keyFs?: KeyFs; repoRoot?: string };

const on = (v: string | undefined) => v === "1" || v === "true";

/** PROTOCOL_ENABLED: the onchain wiring. Default OFF, so production keeps working off-chain. */
export function protocolEnabled(env: Env = process.env): boolean {
  return on(env.PROTOCOL_ENABLED);
}

/** Web app: sponsorship is forwarded to the relayer service when both values are set. */
export function relayerForwardingEnabled(env: Env = process.env): boolean {
  return protocolEnabled(env) && !!env.RELAYER_URL?.trim() && !!env.RELAYER_SERVICE_TOKEN;
}

export const MIN_SERVICE_TOKEN = 32;

function checkRelayerUrl(raw: string, errors: string[]) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    errors.push("RELAYER_URL: not a valid URL");
    return;
  }
  const privateHost = u.hostname.endsWith(".railway.internal") || ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && privateHost)) errors.push("RELAYER_URL: must be https, or http only on Railway private networking (*.railway.internal) or localhost");
}

function checkChain(env: Env, errors: string[], opts: Opts): ProtocolDeployment | null {
  try {
    const id = protocolChainId(env.PROTOCOL_CHAIN_ID);
    const chain = PROTOCOL_CHAINS[id];
    protocolRpcUrl(chain, env.PROTOCOL_RPC_URL);
    if (env.NODE_ENV === "production" && chain.isDev) errors.push("PROTOCOL_CHAIN_ID: Solonet (20143) is for local development only");
    return loadDeployment(id, env, opts.read);
  } catch (e) {
    errors.push(`PROTOCOL: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Web app check. */
export function checkProtocolEnv(env: Env, opts: Opts = {}): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  // The relayer key belongs only on the relayer service, never in the web app (flag on or off).
  if (env.RELAYER_KEY || env.RELAYER_KEY_FILE) errors.push("RELAYER_KEY: must not be set on the web app; it belongs only on the relayer service");
  if (!protocolEnabled(env)) {
    if (env.RELAYER_URL) warnings.push("RELAYER_URL is set but PROTOCOL_ENABLED is off: sponsorship stays off");
    return { errors, warnings };
  }
  checkChain(env, errors, opts);
  const url = env.RELAYER_URL?.trim();
  if (url) {
    checkRelayerUrl(url, errors);
    if ((env.RELAYER_SERVICE_TOKEN ?? "").length < MIN_SERVICE_TOKEN) errors.push(`RELAYER_SERVICE_TOKEN: required with RELAYER_URL, at least ${MIN_SERVICE_TOKEN} random characters`);
  } else {
    warnings.push("RELAYER_URL is not set: no sponsored gas; members submit their signed requests from a wallet of their own");
  }
  return { errors, warnings };
}

/** Relayer service check (relayer/server.ts). */
export function checkRelayerServiceEnv(env: Env, opts: Opts = {}): Report & { address?: string } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!protocolEnabled(env)) errors.push("PROTOCOL_ENABLED: must be 1 on the relayer service");
  const d = checkChain(env, errors, opts);
  if ((env.RELAYER_SERVICE_TOKEN ?? "").length < MIN_SERVICE_TOKEN) errors.push(`RELAYER_SERVICE_TOKEN: at least ${MIN_SERVICE_TOKEN} random characters (same value as the web app)`);
  if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? "")) errors.push("DATABASE_URL: must be the Connect PostgreSQL URL (the spend ledger lives there)");
  errors.push(...relayerLimitsFromEnv(env).errors);
  let address: string | undefined;
  try {
    address = loadRelayerAccount(env, opts.keyFs, opts.repoRoot).address;
    if (d && address.toLowerCase() === d.guardian.toLowerCase()) errors.push("RELAYER_KEY: must be its own hot wallet, not the deployer/guardian");
  } catch (e) {
    errors.push(`RELAYER_KEY: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { errors, warnings, address };
}
