/**
 * Contract addresses by chain id, read from the deployment JSON that `npm run protocol:deploy`
 * writes. No addresses are hardcoded in the app.
 *
 *   10143  deployments/monad-testnet.json (committed after the real testnet deploy)
 *   20143  contracts/deployments/monad-testnet-dryrun-solonet.json (local dry run; git-ignored)
 *   PROTOCOL_DEPLOYMENT_FILE overrides the path.
 *
 * At load it refuses: a chain mismatch, a dev build (short delays) on any chain except Solonet,
 * and testnet delays other than exactly 3 and 7 days.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { CHAIN_SOLONET, CHAIN_TESTNET, PROTOCOL_CHAINS, ProtocolConfigError, type ProtocolChainId } from "./chains";
import { DAY, EIP712_NAME, EIP712_VERSION } from "./typed-data";

export const PROD_DELAY_SECONDS = 3 * DAY;
export const PROD_LONG_DELAY_SECONDS = 7 * DAY;

const addr = z.string().refine((v) => isAddress(v, { strict: false }), "not an address");

const DeploymentJson = z.object({
  chainId: z.number().int(),
  fromBlock: z.number().int().nonnegative(),
  gateway: addr,
  idRegistry: addr,
  keyRegistry: addr,
  guardian: addr,
  delaySeconds: z.number().int().positive(),
  longDelaySeconds: z.number().int().positive(),
  devBuild: z.boolean(),
  eip712Name: z.string(),
  eip712Version: z.string(),
});

export interface ProtocolDeployment {
  chainId: ProtocolChainId;
  fromBlock: bigint;
  gateway: Address;
  idRegistry: Address;
  keyRegistry: Address;
  guardian: Address;
  delaySeconds: number;
  longDelaySeconds: number;
  devBuild: boolean;
}

export function defaultDeploymentPath(chainId: ProtocolChainId, cwd: string = process.cwd()): string {
  return chainId === CHAIN_SOLONET
    ? path.join(cwd, "contracts/deployments/monad-testnet-dryrun-solonet.json")
    : path.join(cwd, "deployments/monad-testnet.json");
}

/** Validates a parsed deployment JSON for `chainId`. Throws ProtocolConfigError with the reason. */
export function parseDeployment(raw: unknown, chainId: ProtocolChainId): ProtocolDeployment {
  const r = DeploymentJson.safeParse(raw);
  if (!r.success) throw new ProtocolConfigError(`deployment JSON is malformed: ${r.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`);
  const d = r.data;
  if (d.chainId !== chainId) throw new ProtocolConfigError(`deployment is for chain ${d.chainId}, but PROTOCOL_CHAIN_ID is ${chainId}`);
  if (d.eip712Name !== EIP712_NAME || d.eip712Version !== EIP712_VERSION) {
    throw new ProtocolConfigError(`deployment EIP-712 domain is ${d.eip712Name} v${d.eip712Version}, expected ${EIP712_NAME} v${EIP712_VERSION}`);
  }
  const chain = PROTOCOL_CHAINS[chainId];
  const prodDelays = d.delaySeconds === PROD_DELAY_SECONDS && d.longDelaySeconds === PROD_LONG_DELAY_SECONDS;
  if (!chain.isDev) {
    if (d.devBuild) throw new ProtocolConfigError(`refusing a dev build (short delays) on chain ${chainId}; dev builds are Solonet-only`);
    if (!prodDelays) throw new ProtocolConfigError(`chain ${chainId} must use 3-day and 7-day delays, deployment has ${d.delaySeconds}s / ${d.longDelaySeconds}s`);
  } else if (d.devBuild === prodDelays) {
    throw new ProtocolConfigError("deployment devBuild flag does not match its delays");
  }
  return {
    chainId,
    fromBlock: BigInt(d.fromBlock),
    gateway: getAddress(d.gateway),
    idRegistry: getAddress(d.idRegistry),
    keyRegistry: getAddress(d.keyRegistry),
    guardian: getAddress(d.guardian),
    delaySeconds: d.delaySeconds,
    longDelaySeconds: d.longDelaySeconds,
    devBuild: d.devBuild,
  };
}

export function loadDeployment(
  chainId: ProtocolChainId,
  env: Record<string, string | undefined> = process.env,
  read: (file: string) => string = (f) => readFileSync(f, "utf8"),
): ProtocolDeployment {
  const file = env.PROTOCOL_DEPLOYMENT_FILE?.trim() ? path.resolve(env.PROTOCOL_DEPLOYMENT_FILE.trim()) : defaultDeploymentPath(chainId);
  let text: string;
  try {
    text = read(file);
  } catch {
    const hint = chainId === CHAIN_TESTNET ? "run the testnet deploy and commit deployments/monad-testnet.json" : "run npm run protocol:deploy -- --solonet";
    throw new ProtocolConfigError(`no deployment file for chain ${chainId} at ${path.relative(process.cwd(), file) || file} (${hint})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProtocolConfigError("deployment file is not valid JSON");
  }
  return parseDeployment(json, chainId);
}
