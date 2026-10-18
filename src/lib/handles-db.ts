import "server-only";
import { prisma } from "./db";
import { isPlaceholderHandle, normalizeHandle, suggestHandle, validateHandle, type HandleError } from "./handles";

/**
 * The handle to save with onboarding step 1: the one the member typed (valid and free), else the
 * current one, except that a placeholder (new_member, from a sign-up without a name) is replaced
 * by one built from the name.
 */
export async function chooseHandle(
  user: { id: string; handle: string },
  raw: string,
  name: string,
): Promise<{ ok: true; handle: string } | { ok: false; error: HandleError | "handle_taken" }> {
  const typed = normalizeHandle(raw);
  if (typed && typed !== user.handle) {
    const v = validateHandle(typed);
    if (!v.ok) return v;
    const clash = await prisma.user.findFirst({ where: { handle: v.value, NOT: { id: user.id } }, select: { id: true } });
    return clash ? { ok: false, error: "handle_taken" } : { ok: true, handle: v.value };
  }
  if (!isPlaceholderHandle(user.handle)) return { ok: true, handle: user.handle };
  const taken = new Set((await prisma.user.findMany({ where: { NOT: { id: user.id } }, select: { handle: true } })).map((u) => u.handle));
  return { ok: true, handle: suggestHandle(name, taken) ?? user.handle };
}
