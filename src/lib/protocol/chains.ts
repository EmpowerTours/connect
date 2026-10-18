/**
 * Which Monad network the Connect protocol wiring talks to. Isomorphic (no secrets, no fs).
 *
 *   20143  Monad Solonet (local dev; dev builds with short delays allowed)
 *   10143  Monad testnet (default)
 *   143    Monad mainnet: REFUSED until the mainnet launch is approved and this file changes.
 *
 * Env (server): PROTOCOL_CHAIN_ID (default 10143), PROTOCOL_RPC_URL (default per chain).
 * PROTOCOL_RPC_URL is separate from MONAD_RPC_URL, which the wallet starter packs use for
 * Monad mainnet reads.
 */
import { defineChain, type Chain } from "viem";

export const CHAIN_SOLONET = 20143;
export const CHAIN_TESTNET = 10143;
export const CHAIN_MAINNET = 143;

export type ProtocolChainId = typeof CHAIN_SOLONET | typeof CHAIN_TESTNET;

export interface ProtocolChain {
  id: ProtocolChainId;
  name: string;
  /** Short delays (dev build) are only acceptable here. */
  isDev: boolean;
  defaultRpc: string;
}

export const PROTOCOL_CHAINS: Record<ProtocolChainId, ProtocolChain> = {
  [CHAIN_SOLONET]: { id: CHAIN_SOLONET, name: "Monad Solonet", isDev: true, defaultRpc: "http://localhost:8080" },
  [CHAIN_TESTNET]: {
    id: CHAIN_TESTNET,
    name: "Monad Testnet",
    isDev: false,
    defaultRpc: "https://rpc-testnet.monadinfra.com",
  },
};

export class ProtocolConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolConfigError";
  }
}

/** Parses and checks a chain id. Mainnet and unknown chains throw. */
export function protocolChainId(raw: string | number | undefined): ProtocolChainId {
  const s = raw === undefined || raw === "" ? String(CHAIN_TESTNET) : String(raw).trim();
  if (!/^\d+$/.test(s)) throw new ProtocolConfigError(`PROTOCOL_CHAIN_ID must be a number, got "${s}"`);
  const n = Number(s);
  if (n === CHAIN_MAINNET) throw new ProtocolConfigError("PROTOCOL_CHAIN_ID 143 (Monad mainnet) is refused: mainnet is not approved yet");
  if (n !== CHAIN_SOLONET && n !== CHAIN_TESTNET) {
    throw new ProtocolConfigError(`PROTOCOL_CHAIN_ID ${n} is not supported (use ${CHAIN_SOLONET} for Solonet or ${CHAIN_TESTNET} for testnet)`);
  }
  return n;
}

/** RPC URL: explicit override, else the chain default. Only http(s). */
export function protocolRpcUrl(chain: ProtocolChain, raw: string | undefined): string {
  const url = (raw ?? "").trim() || chain.defaultRpc;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProtocolConfigError("PROTOCOL_RPC_URL is not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ProtocolConfigError("PROTOCOL_RPC_URL must be http(s)");
  // Plain http only for local nodes; a remote RPC must be https.
  const local = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(u.hostname);
  if (u.protocol === "http:" && !local) throw new ProtocolConfigError("PROTOCOL_RPC_URL must use https for a remote RPC");
  return url;
}

export function viemChain(chain: ProtocolChain, rpcUrl: string): Chain {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
}

/** Monad charges the gas LIMIT, so the limit is the estimate plus 10%, rounded up. */
export function gasLimitFromEstimate(estimate: bigint): bigint {
  return (estimate * BigInt(110) + BigInt(99)) / BigInt(100);
}
