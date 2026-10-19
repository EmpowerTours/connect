import { relayerForwardingEnabled } from "@/lib/protocol/env-check";
import { json, protocolOr404 } from "@/lib/protocol/server";
import { EIP712_NAME, EIP712_VERSION } from "@/lib/protocol/typed-data";

export const dynamic = "force-dynamic";

/** Public protocol config for the client: chain, contracts, delays, and whether sponsorship is on. 404 while the flag is off. */
export async function GET() {
  const g = protocolOr404();
  if (!g.ok) return g.res;
  const { chain, deployment: d } = g.p.config;
  return json({
    chainId: chain.id,
    chainName: chain.name,
    gateway: d.gateway,
    idRegistry: d.idRegistry,
    keyRegistry: d.keyRegistry,
    fromBlock: d.fromBlock.toString(),
    delaySeconds: d.delaySeconds,
    longDelaySeconds: d.longDelaySeconds,
    devBuild: d.devBuild,
    eip712: { name: EIP712_NAME, version: EIP712_VERSION },
    sponsorship: relayerForwardingEnabled(),
  });
}
