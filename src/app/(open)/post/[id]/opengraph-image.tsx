import { APP_FULL_NAME } from "@/lib/brand";
import { countLabel, initialsOf, OG_SIZE, ogCard } from "@/lib/og-card";
import { getPublicPost } from "@/lib/public-pages";
import { snippet } from "@/lib/seo";

/** Post link preview: the author and the text of the update. */
export const alt = `Update on ${APP_FULL_NAME}`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const post = await getPublicPost((await params).id);
  if (!post) return ogCard({ initials: "?", name: APP_FULL_NAME, handle: "connect" });
  const line = [post.author.headline, post.author.orgName].filter(Boolean).join(" @ ");
  const counts = [countLabel(post._count.replies, "reply", "replies"), countLabel(post._count.likes, "like", "likes")].join(" · ");
  return ogCard({
    initials: initialsOf(post.author.name),
    name: snippet(post.author.name, 40),
    handle: post.author.handle,
    line: snippet(line, 60),
    body: snippet(post.body, 260),
    footer: counts,
  });
}
