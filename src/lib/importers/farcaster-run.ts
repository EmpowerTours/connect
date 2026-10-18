import "server-only";
import { prisma } from "../db";
import { FarcasterUnavailable, MAX_FOLLOWING, bioToImport, getFarcasterProvider, isOwnAccount, matchFarcasterFollowing, normalizeFarcasterUsername } from "./farcaster";
import { persistDrafts, recordRun } from "./persist";
import { userKey, type SuggestionDraft } from "./suggestions";

export type FarcasterRunError = "username" | "need_wallet" | "not_found" | "not_found_wallet" | "unavailable";

export type FarcasterRunResult =
  | { ok: true; found: number; matched: number; partial: boolean; username: string; bioImported: boolean }
  | { ok: false; error: FarcasterRunError; why?: string };

/**
 * One Farcaster import for a member (the /import page and onboarding share it): find the account
 * by username (or by the member's verified wallet), record the link, fill an empty bio from the
 * Farcaster profile, then turn the accounts it follows into pending follow suggestions. Uses the
 * public hub, or Neynar when NEYNAR_API_KEY is set; a source that is down is an error result,
 * never a thrown error. The caller checks the session and the rate limit.
 */
export async function runFarcasterImport(
  user: { id: string; bio: string; walletVerified: boolean; walletAddress: string | null },
  rawUsername: string,
): Promise<FarcasterRunResult> {
  const wallet = user.walletVerified && user.walletAddress ? user.walletAddress : null;
  const raw = rawUsername.trim();
  const username = raw ? normalizeFarcasterUsername(raw) : null;
  if (raw && !username) return { ok: false, error: "username" };
  if (!username && !wallet) return { ok: false, error: "need_wallet" };

  const provider = getFarcasterProvider();
  try {
    const account = username ? await provider.findByUsername(username) : (await provider.findByAddresses([wallet!]))[0] ?? null;
    if (!account) return { ok: false, error: username ? "not_found" : "not_found_wallet" };
    const verified = !!wallet && isOwnAccount(account, [wallet]);
    const bio = bioToImport(user.bio, account);
    await prisma.$transaction(async (tx) => {
      // A wallet-proven link wins: nobody else can stay verified for this fid.
      if (verified) await tx.user.updateMany({ where: { farcasterFid: account.fid, NOT: { id: user.id } }, data: { farcasterVerified: false } });
      await tx.user.update({
        where: { id: user.id },
        data: { farcasterFid: account.fid, farcasterUsername: account.username, farcasterVerified: verified, ...(bio ? { bio } : {}) },
      });
    });
    // Bounded walk (per-request timeouts plus an overall budget); a slow source yields a partial list.
    const { fids, partial } = await provider.followingWithStatus(account.fid, MAX_FOLLOWING);
    const members = await prisma.user.findMany({
      where: { farcasterVerified: true, farcasterFid: { in: fids } },
      select: { id: true, farcasterFid: true, farcasterVerified: true, farcasterUsername: true },
    });
    const drafts: SuggestionDraft[] = matchFarcasterFollowing(fids, members).map((m) => ({
      key: userKey(m.userId),
      targetUserId: m.userId,
      reason: { source: "farcaster", code: "fc_follow", detail: m.username },
    }));
    const matched = await persistDrafts(user.id, drafts);
    await recordRun(user.id, "farcaster", fids.length, matched, { fid: account.fid, username: account.username, verified, provider: provider.name, partial, bioImported: !!bio });
    return { ok: true, found: fids.length, matched, partial, username: account.username, bioImported: !!bio };
  } catch (e) {
    if (e instanceof FarcasterUnavailable) return { ok: false, error: "unavailable", why: e.message };
    throw e;
  }
}
