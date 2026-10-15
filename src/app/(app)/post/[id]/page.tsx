import { notFound } from "next/navigation";
import { UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { Composer } from "@/components/composer";
import { Columns, PageHeader } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { postInclude } from "@/lib/feed";
import { t } from "@/lib/i18n";
import { buildThread, flattenThread } from "@/lib/posts";
import { getPostCtx } from "@/lib/post-ctx";

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const locale = await getLocale();
  const include = postInclude(user.id);
  const post = await prisma.post.findUnique({ where: { id }, include });
  if (!post) notFound();
  const ctx = await getPostCtx(user, locale);

  // Ancestors (parent chain) above the focused cast.
  const ancestors: (typeof post)[] = [];
  let cursor = post.parentId;
  while (cursor && ancestors.length < 10) {
    const p = await prisma.post.findUnique({ where: { id: cursor }, include });
    if (!p) break;
    ancestors.unshift(p);
    cursor = p.parentId;
  }
  // Descendants: everything in the same thread, rebuilt as a tree under this post.
  const rootId = post.rootId ?? post.id;
  const threadPosts = await prisma.post.findMany({ where: { OR: [{ rootId }, { id: rootId }] }, include, orderBy: { createdAt: "asc" } });
  const subtree = buildThread(threadPosts, post.id);
  const replies = subtree ? flattenThread(subtree, 3).slice(1) : [];

  return (
    <Columns>
      <PageHeader title={t(locale, "post.thread")} back="/more" />
      {ancestors.map((a, i) => (
        <PostCard key={a.id} item={{ key: a.id, post: a, at: a.createdAt }} ctx={ctx} variant="thread" connector={i === 0 ? "bottom" : "both"} />
      ))}
      <div className="border-b border-line">
        <PostCard item={{ key: post.id, post, at: post.createdAt }} ctx={ctx} variant="focus" connector={ancestors.length ? "top" : undefined} />
        <div className="h-3" />
      </div>
      <div id="reply" className="border-b border-line">
        <Composer locale={locale} channels={ctx.channels} parentId={post.id} author={<UserAvatar name={user.name} seed={user.handle} src={avatarUrl(user.avatarKey)} size={42} />} />
      </div>
      {replies.map(({ post: r, depth }) => (
        <div key={r.id} className="border-b border-line">
          <div className={depth > 1 ? "border-l-2 border-line-strong/70" : ""} style={{ marginLeft: `${(depth - 1) * 24 + (depth > 1 ? 24 : 0)}px` }}>
            <PostCard item={{ key: r.id, post: r, at: r.createdAt }} ctx={ctx} variant="thread" />
          </div>
        </div>
      ))}
      {replies.length === 0 && <p className="px-4 py-10 text-center text-sm text-faint">{t(locale, "post.noReplies")}</p>}
    </Columns>
  );
}
