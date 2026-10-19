import { z } from "zod";
import { json, protocolMember, protocolOr404, sponsorStore } from "@/lib/protocol/server";
import { verifyCheck } from "@/lib/protocol/sponsor/checks";
import { sponsorSecret } from "@/lib/protocol/sponsor/identity";
import { readJson } from "../../../../auth/respond";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().min(1).max(12) });

/** Checks the one-time code; on success the member's sign-up and key actions are sponsored. */
export async function POST(req: Request) {
  const g = protocolOr404();
  if (!g.ok) return g.res;
  const m = await protocolMember();
  if (!m.ok) return m.res;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "invalid payload" }, 400);
  const r = await verifyCheck({ store: sponsorStore(), secret: sponsorSecret(), userId: m.member.id, code: parsed.data.code });
  if (!r.ok) return json({ error: r.error, code: r.code, attemptsLeft: r.attemptsLeft }, r.status);
  return json({ sponsored: "verified", channel: r.channel });
}
