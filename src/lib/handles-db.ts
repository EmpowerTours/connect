import "server-only";
import { prisma } from "./db";
import { isGeneratedPlaceholder, normalizeHandle, suggestHandle, validateHandle, type HandleError } from "./handles";

/**
 * The handle to save with onboarding step 1: the one the member typed (valid and free), else the
 * current one, except that a generated placeholder (new_member on a "New member" account, from a
 * sign-up without a name) is replaced by one built from the name, or must be typed.
 */
export async function chooseHandle(
  user: { id: string; handle: string; name: string },
  raw: string,
  name: string,
): Promise<{ ok: true; handle: string } | { ok: false; error: HandleError | "handle_taken" | "handle_required" }> {
  const typed = normalizeHandle(raw);
  if (typed && typed !== user.handle) {
    const v = validateHandle(typed);
    if (!v.ok) return v;
    const clash = await prisma.user.findFirst({ where: { handle: v.value, NOT: { id: user.id } }, select: { id: true } });
    return clash ? { ok: false, error: "handle_taken" } : { ok: true, handle: v.value };
  }
  if (!isGeneratedPlaceholder(user)) return { ok: true, handle: user.handle };
  const taken = new Set((await prisma.user.findMany({ where: { NOT: { id: user.id } }, select: { handle: true } })).map((u) => u.handle));
  const suggested = suggestHandle(name, taken);
  // No usable handle from the name (e.g. "Member"): the member has to type one.
  return suggested ? { ok: true, handle: suggested } : { ok: false, error: "handle_required" };
}
