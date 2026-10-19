import { z } from "zod";
import { json, protocolMember, protocolOr404, requestIpHash, sponsorStore } from "@/lib/protocol/server";
import { startCheck } from "@/lib/protocol/sponsor/checks";
import { sponsorSecret } from "@/lib/protocol/sponsor/identity";
import { senderFor } from "@/lib/protocol/sponsor/senders";
import { logger } from "@/lib/log";
import { readJson } from "../../../../auth/respond";

export const dynamic = "force-dynamic";

const Body = z.object({ channel: z.enum(["email", "phone"]), address: z.string().min(3).max(254) });

/** Sends a one-time code to the member's email (or phone, when a provider is configured). */
export async function POST(req: Request) {
  const g = protocolOr404();
  if (!g.ok) return g.res;
  const m = await protocolMember();
  if (!m.ok) return m.res;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "invalid payload" }, 400);
  const { channel, address } = parsed.data;
  const r = await startCheck({ store: sponsorStore(), sender: senderFor(channel), secret: sponsorSecret(), userId: m.member.id, channel, address, ipHash: await requestIpHash() });
  if (!r.ok) {
    if (r.code === "send_failed") logger.error("[protocol] sponsor code send failed", { scope: "protocol", channel });
    return json({ error: r.error, code: r.code }, r.status);
  }
  return json({ sentTo: r.sentTo, channel: r.channel, expiresAt: r.expiresAt.toISOString() });
}
