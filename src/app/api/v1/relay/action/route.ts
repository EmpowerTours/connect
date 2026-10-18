import { ActionPayloadSchema, toWire } from "@/lib/protocol/payloads";
import { forwardToRelayer, json, protocolMember, protocolOr404 } from "@/lib/protocol/server";
import { readJson } from "../../../auth/respond";

export const dynamic = "force-dynamic";

/**
 * Sponsored action on the member's own Connect ID (add/suspend/retire a key, start/cancel/finalize
 * a delayed op). The relayer service decides whether to pay; a refusal says selfPay.
 */
export async function POST(req: Request) {
  const g = protocolOr404();
  if (!g.ok) return g.res;
  const m = await protocolMember();
  if (!m.ok) return m.res;
  const parsed = ActionPayloadSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "invalid payload" }, 400);
  return forwardToRelayer("action", m.member, toWire(parsed.data));
}
