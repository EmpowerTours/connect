import Link from "next/link";
import { notFound } from "next/navigation";
import { toggleFollowUserAction } from "@/app/actions";
import { Avatar, OrgChip, VerifiedBadge, timeAgo } from "@/components/ui";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function UserPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const me = await requireUser();
  const locale = await getLocale();
  const user = await prisma.user.findUnique({
    where: { handle },
    include: {
      org: true,
      _count: { select: { followers: true, following: true } },
      followers: { where: { followerId: me.id } },
      posts: { orderBy: { createdAt: "desc" }, take: 30, include: { orgs: { include: { org: { select: { slug: true, name: true } } } } } },
    },
  });
  if (!user) notFound();
  const following = user.followers.length > 0;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="card flex flex-wrap items-start gap-4 p-5">
        <Avatar name={user.name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">{user.name} <VerifiedBadge verified={user.verified} locale={locale} /></h1>
          <p className="text-sm text-zinc-500">
            @{user.handle}
            {user.role && ` · ${user.role}`}
            {user.org ? (
              <> @ <Link href={`/orgs/${user.org.slug}`} className="text-violet-300">{user.org.name}</Link></>
            ) : user.orgName ? ` @ ${user.orgName}` : ""}
          </p>
          {user.bio && <p className="mt-2 text-sm text-zinc-300">{user.bio}</p>}
          <p className="mt-2 text-xs text-zinc-500">
            <b className="text-zinc-200">{user._count.followers}</b> {t(locale, "profile.followers")} · <b className="text-zinc-200">{user._count.following}</b> {t(locale, "profile.followingCount")}
          </p>
        </div>
        {me.id === user.id ? (
          <Link href="/profile" className="btn-ghost">{t(locale, "nav.profile")}</Link>
        ) : (
          <form action={toggleFollowUserAction}>
            <input type="hidden" name="userId" value={user.id} />
            <button className={following ? "btn-ghost" : "btn-primary"}>{following ? `✓ ${t(locale, "profile.unfollow")}` : `+ ${t(locale, "profile.follow")}`}</button>
          </form>
        )}
      </div>
      <ul className="space-y-3">
        {user.posts.map((p) => (
          <li key={p.id} className="card p-4">
            <p className="text-xs text-zinc-500">{timeAgo(p.createdAt, locale)}</p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-200">{p.body}</p>
            <div className="mt-2 flex flex-wrap gap-1">{p.orgs.map(({ org }) => <OrgChip key={org.slug} slug={org.slug} name={org.name} />)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
