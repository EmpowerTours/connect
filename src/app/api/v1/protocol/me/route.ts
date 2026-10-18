import type { Hex } from "viem";
import { ProtocolReader } from "@/lib/protocol/reader";
import { prisma } from "@/lib/db";
import { PrismaRelayLedger } from "@/lib/protocol/relayer/ledger-db";
import { json, protocolMember, protocolOr404, sponsorEligibility } from "@/lib/protocol/server";

export const dynamic = "force-dynamic";

const HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * The signed-in member's Connect ID, read from chain: owner, recovery, nonces and keys.
 * `?device=<keyHash>` adds this device's key and its own nonce.
 */
export async function GET(req: Request) {
  const g = protocolOr404();
  if (!g.ok) return g.res;
  const m = await protocolMember(false);
  if (!m.ok) return m.res;
  const { client, config } = g.p;
  const reader = new ProtocolReader(client, config.deployment);
  const device = new URL(req.url).searchParams.get("device");
  const deviceHash = device && HASH.test(device) ? (device.toLowerCase() as Hex) : null;
  const wallet = m.member.wallet;
  try {
    const [identity, registerNonce, paused, eligibility] = await Promise.all([
      reader.identityOf(wallet),
      reader.registerNonce(wallet),
      reader.paused(),
      sponsorEligibility(m.member.id),
    ]);
    const base = { chainId: config.chain.id, wallet, registerNonce: registerNonce.toString(), paused, sponsored: eligibility?.source ?? null };
    if (!identity) return json({ ...base, registered: false });
    const known = await new PrismaRelayLedger(prisma).keyHashesFor(config.chain.id, identity.id.toString(), wallet.toLowerCase());
    const keys = await reader.keys(identity.id, [...known, ...(deviceHash ? [deviceHash] : [])] as Hex[]);
    return json({
      ...base,
      registered: true,
      connectId: identity.id.toString(),
      owner: identity.owner,
      recovery: identity.recovery,
      nonce: identity.nonce.toString(),
      recoveryNonce: identity.recoveryNonce.toString(),
      device: deviceHash ? { keyHash: deviceHash, nonce: (await reader.deviceNonce(identity.id, deviceHash)).toString() } : null,
      keys: keys.map((k) => ({ ...k, thisDevice: k.keyHash === deviceHash })),
    });
  } catch {
    return json({ error: "could not read the chain right now" }, 502);
  }
}
