"use server";

import { limitMember } from "@/lib/rate-limit-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FarcasterUnavailable, MAX_FOLLOWING, getFarcasterProvider, isOwnAccount, matchFarcasterFollowing, normalizeFarcasterUsername } from "@/lib/importers/farcaster";
import { channelKey, filterDrafts, mergeReasons, parseReasons, userKey, type ImportSource, type SuggestionDraft } from "@/lib/importers/suggestions";
import { STARTER_PACKS, MAX_MEMBERS_CHECKED, PACK_CHECK_TTL_MS, httpRpc, mapLimit, packsHeldBy, holdsPack, RpcUnavailable } from "@/lib/importers/wallet";
import { MAX_X_FILE_BYTES, matchXFollowing, parseXFile, selfAccountMatchesProfile, type XArchiveParse } from "@/lib/importers/x";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Stores drafts as pending suggestions; repeat imports add reasons instead of duplicating. */
async function persistDrafts(userId: string, drafts: SuggestionDraft[]): Promise<number> {
  const [following, joined] = await Promise.all([
    prisma.followUser.findMany({ where: { followerId: userId }, select: { followeeId: true } }),
    prisma.channelMember.findMany({ where: { userId }, select: { channelId: true } }),
  ]);
  const clean = filterDrafts(drafts, {
    viewerId: userId,
    following: new Set(following.map((f) => f.followeeId)),
    joinedChannels: new Set(joined.map((j) => j.channelId)),
  });
  for (const d of clean) {
    const existing = await prisma.importSuggestion.findUnique({ where: { userId_key: { userId, key: d.key } } });
    if (existing) {
      await prisma.importSuggestion.update({ where: { id: existing.id }, data: { reasons: JSON.stringify(mergeReasons(parseReasons(existing.reasons), d.reason)) } });
    } else {
      await prisma.importSuggestion.create({
        data: { userId, key: d.key, targetUserId: d.targetUserId ?? null, channelId: d.channelId ?? null, reasons: JSON.stringify([d.reason]) },
      });
    }
  }
  return clean.length;
}

async function recordRun(userId: string, source: ImportSource, found: number, matched: number, detail: Record<string, unknown>) {
  await prisma.importRun.create({ data: { userId, source, found, matched, detail: JSON.stringify(detail) } });
}

function done(source: ImportSource, extra = ""): never {
  revalidatePath("/import");
  redirect(`/import?ran=${source}${extra}#suggestions`);
}

/* ---------- Farcaster ---------- */

export async function importFarcasterAction(fd: FormData) {
  const user = await requireUser();
  if (!(await limitMember(user.id, "import")).ok) redirect("/import?fcError=rate_limited#farcaster");
  const wallet = user.walletVerified && user.walletAddress ? user.walletAddress : null;
  const raw = str(fd, "username");
  const username = raw ? normalizeFarcasterUsername(raw) : null;
  if (raw && !username) redirect("/import?fcError=username#farcaster");
  if (!username && !wallet) redirect("/import?fcError=need_wallet#farcaster");

  const provider = getFarcasterProvider();
  try {
    const account = username ? await provider.findByUsername(username) : (await provider.findByAddresses([wallet!]))[0] ?? null;
    if (!account) redirect(`/import?fcError=${username ? "not_found" : "not_found_wallet"}#farcaster`);
    const verified = !!wallet && isOwnAccount(account, [wallet]);
    await prisma.$transaction(async (tx) => {
      // A wallet-proven link wins: nobody else can stay verified for this fid.
      if (verified) await tx.user.updateMany({ where: { farcasterFid: account.fid, NOT: { id: user.id } }, data: { farcasterVerified: false } });
      await tx.user.update({ where: { id: user.id }, data: { farcasterFid: account.fid, farcasterUsername: account.username, farcasterVerified: verified } });
    });
    const fids = await provider.following(account.fid, MAX_FOLLOWING);
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
    await recordRun(user.id, "farcaster", fids.length, matched, { fid: account.fid, username: account.username, verified, provider: provider.name });
  } catch (e) {
    if (e instanceof FarcasterUnavailable) redirect(`/import?fcError=unavailable&why=${encodeURIComponent(e.message)}#farcaster`);
    throw e;
  }
  done("farcaster");
}

/* ---------- X archive upload ---------- */

export async function importXAction(fd: FormData) {
  const user = await requireUser();
  if (!(await limitMember(user.id, "import")).ok) redirect("/import?xError=rate_limited#x");
  const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  if (!files.length) redirect("/import?xError=empty#x");
  if (files.length > 4 || files.some((f) => f.size > MAX_X_FILE_BYTES)) redirect("/import?xError=too_large#x");
  const parsed: XArchiveParse = { handles: [], accountIds: [], self: null, skipped: 0 };
  for (const f of files) parseXFile(await f.text(), parsed);
  if (!parsed.handles.length && !parsed.accountIds.length && !parsed.self) redirect("/import?xError=unreadable#x");

  let selfNote: "recorded" | "mismatch" | "none" = "none";
  if (parsed.self) {
    if (selfAccountMatchesProfile(parsed.self, user.linkX)) {
      await prisma.user.update({ where: { id: user.id }, data: { xAccountId: parsed.self.accountId } });
      selfNote = "recorded";
    } else selfNote = "mismatch";
  }
  const members = await prisma.user.findMany({
    where: { NOT: { id: user.id }, OR: [{ linkX: { not: "" } }, { xAccountId: { not: null } }] },
    select: { id: true, linkX: true, xAccountId: true },
  });
  const drafts: SuggestionDraft[] = matchXFollowing(parsed, members).map((m) => ({
    key: userKey(m.userId),
    targetUserId: m.userId,
    reason: { source: "x", code: "x_follow", detail: m.handle },
  }));
  const matched = await persistDrafts(user.id, drafts);
  const found = parsed.handles.length + parsed.accountIds.length;
  await recordRun(user.id, "x", found, matched, { handles: parsed.handles.length, ids: parsed.accountIds.length, self: selfNote, skipped: parsed.skipped });
  done("x");
}

/* ---------- wallet starter packs ---------- */

export async function importWalletAction() {
  const user = await requireUser();
  if (!(await limitMember(user.id, "import")).ok) redirect("/import?walletError=rate_limited#wallet");
  if (!user.walletVerified || !user.walletAddress) redirect("/import?walletError=need_wallet#wallet");
  const rpc = httpRpc();
  const mine = await packsHeldBy(rpc, user.walletAddress);
  if (mine.failed.length === STARTER_PACKS.length) redirect("/import?walletError=unavailable#wallet");
  const now = new Date();
  for (const p of STARTER_PACKS) {
    if (mine.failed.includes(p.id)) continue;
    await prisma.walletPackCheck.upsert({
      where: { userId_packId: { userId: user.id, packId: p.id } },
      create: { userId: user.id, packId: p.id, member: mine.held.includes(p.id), checkedAt: now },
      update: { member: mine.held.includes(p.id), checkedAt: now },
    });
  }

  const drafts: SuggestionDraft[] = [];
  if (mine.held.length) {
    const others = await prisma.user.findMany({
      where: { walletVerified: true, walletAddress: { not: null }, NOT: { id: user.id } },
      select: { id: true, walletAddress: true },
      orderBy: { walletVerifiedAt: "desc" },
      take: MAX_MEMBERS_CHECKED,
    });
    const fresh = new Date(now.getTime() - PACK_CHECK_TTL_MS);
    const cached = await prisma.walletPackCheck.findMany({ where: { userId: { in: others.map((o) => o.id) }, checkedAt: { gte: fresh } } });
    const cache = new Map(cached.map((c) => [`${c.userId}:${c.packId}`, c.member]));
    for (const packId of mine.held) {
      const pack = STARTER_PACKS.find((p) => p.id === packId)!;
      const results = await mapLimit(others, 4, async (o) => {
        const hit = cache.get(`${o.id}:${packId}`);
        if (hit !== undefined) return { id: o.id, member: hit };
        try {
          const member = await holdsPack(rpc, pack, o.walletAddress!);
          await prisma.walletPackCheck.upsert({
            where: { userId_packId: { userId: o.id, packId } },
            create: { userId: o.id, packId, member, checkedAt: now },
            update: { member, checkedAt: now },
          });
          return { id: o.id, member };
        } catch (e) {
          if (e instanceof RpcUnavailable) return { id: o.id, member: false };
          throw e;
        }
      });
      for (const r of results) if (r.member) drafts.push({ key: userKey(r.id), targetUserId: r.id, reason: { source: "wallet", code: "wallet_pack", detail: packId } });
      const channel = await prisma.channel.findUnique({ where: { slug: pack.channelSlug } });
      if (channel) drafts.push({ key: channelKey(channel.id), channelId: channel.id, reason: { source: "wallet", code: "wallet_channel", detail: packId } });
    }
  }
  const matched = await persistDrafts(user.id, drafts);
  await recordRun(user.id, "wallet", mine.held.length, matched, { held: mine.held, failed: mine.failed, wallet: user.walletAddress });
  done("wallet");
}

/* ---------- confirm / dismiss ---------- */

export async function followSuggestionsAction(fd: FormData) {
  const user = await requireUser();
  const ids = fd.getAll("ids").map(String).slice(0, 500);
  const picked = await prisma.importSuggestion.findMany({ where: { id: { in: ids }, userId: user.id, status: "pending" } });
  for (const s of picked) {
    if (s.targetUserId && s.targetUserId !== user.id) {
      await prisma.followUser.upsert({
        where: { followerId_followeeId: { followerId: user.id, followeeId: s.targetUserId } },
        create: { followerId: user.id, followeeId: s.targetUserId },
        update: {},
      });
    }
    if (s.channelId) {
      await prisma.channelMember.upsert({
        where: { userId_channelId: { userId: user.id, channelId: s.channelId } },
        create: { userId: user.id, channelId: s.channelId },
        update: {},
      });
    }
    await prisma.importSuggestion.update({ where: { id: s.id }, data: { status: "followed" } });
  }
  revalidatePath("/", "layout");
  // No anchor: the confirmation banner sits at the top of the page.
  redirect(`/import?followed=${picked.length}`);
}

export async function dismissSuggestionsAction(fd: FormData) {
  const user = await requireUser();
  const ids = fd.getAll("ids").map(String).slice(0, 500);
  const r = await prisma.importSuggestion.updateMany({ where: { id: { in: ids }, userId: user.id, status: "pending" }, data: { status: "dismissed" } });
  revalidatePath("/import");
  redirect(`/import?dismissed=${r.count}`);
}
