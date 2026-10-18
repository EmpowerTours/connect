import { RegisterPayloadSchema, toWire } from "@/lib/protocol/payloads";
import { forwardToRelayer, json, protocolMember, protocolOr404 } from "@/lib/protocol/server";
import { readJson } from "../../../auth/respond";

export const dynamic = "force-dynamic";

/**
 * Sponsored registration: the member's Mera-signed Register (an EIP-712 message, not a
 * transaction). The relayer service decides whether to pay; a refusal says selfPay.
 */
export async function POST(req: Request) {
  const g = protocolOr404();
  if (!g.ok) return g.res;
  const m = await protocolMember();
  if (!m.ok) return m.res;
  const parsed = RegisterPayloadSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "invalid payload" }, 400);
  return forwardToRelayer("register", m.member, toWire(parsed.data));
}
