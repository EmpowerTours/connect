import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { acceptSigned } from "@/lib/graph/server";
import { GRAPH_ACTIONS } from "@/lib/graph/typed-data";
import { limitMember, tooManyResponse } from "@/lib/rate-limit-server";
import { readJson } from "../../auth/respond";

export const dynamic = "force-dynamic";

const Body = z.object({
  items: z
    .array(
      z.object({
        message: z.object({
          author: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          action: z.enum(GRAPH_ACTIONS),
          subject: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          object: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          ref: z.string().max(200),
          seq: z.number().int().positive(),
          issuedAt: z.number().int().positive(),
        }),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      }),
    )
    .min(1)
    .max(200),
});

/** Append signed graph updates. Verified server-side; all or nothing. Nothing touches the chain. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const rl = await limitMember(user.id, "graphSign");
  if (!rl.ok) return tooManyResponse(rl);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const r = await acceptSigned(user, parsed.data.items);
  if (!r.ok) return NextResponse.json({ error: r.error, index: r.index }, { status: r.status });
  return NextResponse.json({ stored: r.stored }, { status: 201 });
}
