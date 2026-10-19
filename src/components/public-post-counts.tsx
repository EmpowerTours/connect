import Link from "next/link";
import { Heart, MessageCircle, Repeat2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { loginPath } from "@/lib/links";

/** Read-only counts for signed-out visitors; every action leads to sign-in and back to the post. */
export function PublicPostCounts({ postId, locale, counts }: { postId: string; locale: Locale; counts: { replies: number; recasts: number; likes: number } }) {
  const href = loginPath(`/post/${postId}`, { join: true });
  const item = "relative z-10 inline-flex items-center gap-1.5 rounded-full py-1 pr-2 text-[13px] tabular-nums transition hover:text-accent";
  return (
    <div className="relative z-10 -ml-0.5 mt-2 flex max-w-sm items-center justify-between text-faint">
      <Link href={href} className={item} aria-label={t(locale, "post.reply")}><MessageCircle size={17} />{counts.replies > 0 && counts.replies}</Link>
      <Link href={href} className={item} aria-label={t(locale, "post.recast")}><Repeat2 size={18} />{counts.recasts > 0 && counts.recasts}</Link>
      <Link href={href} className={item} aria-label={t(locale, "post.like")}><Heart size={17} />{counts.likes > 0 && counts.likes}</Link>
    </div>
  );
}
