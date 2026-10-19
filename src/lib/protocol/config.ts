/**
 * Server-side protocol configuration and the feature flag.
 *
 *   PROTOCOL_ENABLED=1        turn the onchain wiring on (default OFF: production keeps working off-chain)
 *   PROTOCOL_CHAIN_ID         10143 (default) or 20143; 143 is refused
 *   PROTOCOL_RPC_URL          RPC override (default per chain)
 *   PROTOCOL_DEPLOYMENT_FILE  deployment JSON override
 *
 * When the flag is off nothing here touches the chain or the deployment file.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { PROTOCOL_CHAINS, protocolChainId, protocolRpcUrl, viemChain, type ProtocolChain } from "./chains";
import { loadDeployment, type ProtocolDeployment } from "./deployments";
import { protocolEnabled } from "./env-check";

type Env = Record<string, string | undefined>;

export interface ProtocolConfig {
  chain: ProtocolChain;
  rpcUrl: string;
  deployment: ProtocolDeployment;
}

export { protocolEnabled };

/** Resolves and validates the config. Throws ProtocolConfigError on any misconfiguration. */
export function resolveProtocolConfig(env: Env = process.env, read?: (file: string) => string): ProtocolConfig {
  const id = protocolChainId(env.PROTOCOL_CHAIN_ID);
  const chain = PROTOCOL_CHAINS[id];
  const rpcUrl = protocolRpcUrl(chain, env.PROTOCOL_RPC_URL);
  const deployment = loadDeployment(id, env, read);
  return { chain, rpcUrl, deployment };
}

let cached: { config: ProtocolConfig; client: PublicClient } | null = null;

/** The live config, or null when the flag is off. Cached per process. */
export function getProtocol(): { config: ProtocolConfig; client: PublicClient } | null {
  if (!protocolEnabled()) return null;
  if (!cached) {
    const config = resolveProtocolConfig();
    const client = createPublicClient({ chain: viemChain(config.chain, config.rpcUrl), transport: http(config.rpcUrl, { timeout: 15_000 }) });
    cached = { config, client: client as PublicClient };
  }
  return cached;
}

/** Test hook. */
export function resetProtocolCache(): void {
  cached = null;
}
