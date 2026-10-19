import { APP_FULL_NAME } from "@/lib/brand";
import { countLabel, initialsOf, OG_SIZE, ogCard } from "@/lib/og-card";
import { getPublicUser } from "@/lib/public-pages";
import { snippet } from "@/lib/seo";

/** Profile link preview: name, handle, role and bio. Public fields only. */
export const alt = `Profile on ${APP_FULL_NAME}`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const user = await getPublicUser((await params).handle);
  if (!user) return ogCard({ initials: "?", name: APP_FULL_NAME, handle: "connect" });
  const line = [user.headline || user.role, user.orgName].filter(Boolean).join(" @ ");
  return ogCard({
    initials: initialsOf(user.name),
    name: snippet(user.name, 40),
    handle: user.handle,
    line: snippet(line, 60),
    body: snippet(user.bio, 160),
    footer: [countLabel(user._count.followers, "follower", "followers"), countLabel(user._count.posts, "update", "updates")].join(" · "),
  });
}
