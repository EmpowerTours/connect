import Link from "next/link";
import { CornerDownRight, Hash, Repeat2 } from "lucide-react";
import type { FeedItem, FeedPost } from "@/lib/feed";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { OrgLogo, UserAvatar } from "./avatar";
import { DemoBadge, PostKindChip, VerifiedTick } from "./badges";
import { PostActions } from "./post-actions";
import { RichText } from "./rich-text";
import { timeAgo } from "./time";

export interface PostCtx {
  locale: Locale;
  known: { orgs: Set<string>; handles: Set<string>; channels: Set<string> };
  channels: { slug: string; name: string }[];
  viewer: { name: string; handle: string };
}

type Author = FeedPost["author"];

function AuthorLine({ author, at, locale, size = "md", linked = true }: { author: Author; at: Date; locale: Locale; size?: "md" | "sm"; linked?: boolean }) {
  const verified = author.workEmailVerified || author.linkedinVerified || author.walletVerified;
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${size === "sm" ? "text-[13px]" : "text-[15px]"}`}>
      {linked ? (
        <Link href={`/u/${author.handle}`} className="relative z-10 truncate font-semibold hover:underline">
          {author.name}
        </Link>
      ) : (
        <span className="truncate font-semibold">{author.name}</span>
      )}
      <VerifiedTick verified={verified} />
      {author.isDemo && <DemoBadge locale={locale} />}
      <span className="truncate text-faint">@{author.handle}</span>
      <span className="text-faint">·</span>
      <time dateTime={at.toISOString()} className="shrink-0 text-faint" title={at.toLocaleString()}>
        {timeAgo(at, locale)}
      </time>
    </div>
  );
}

export function QuoteEmbed({ post, ctx }: { post: NonNullable<FeedPost["quoteOf"]>; ctx: PostCtx }) {
  return (
    <Link href={`/post/${post.id}`} className="relative z-10 mt-2.5 block rounded-2xl border border-line p-3 transition hover:border-line-strong hover:bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <UserAvatar name={post.author.name} seed={post.author.handle} size={20} />
        <AuthorLine author={post.author} at={post.createdAt} locale={ctx.locale} size="sm" linked={false} />
      </div>
      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-[14px] leading-relaxed text-fg/90">{post.body}</p>
    </Link>
  );
}

export function PostCard({ item, ctx, variant = "feed", connector }: { item: FeedItem; ctx: PostCtx; variant?: "feed" | "focus" | "thread"; connector?: "top" | "bottom" | "both" }) {
  const { post } = item;
  const focus = variant === "focus";
  return (
    <article className={`group/post relative px-4 transition-colors ${focus ? "pt-4" : "py-3.5 hover:bg-white/[0.015]"} ${variant === "feed" ? "border-b border-line" : ""}`}>
      {!focus && <Link href={`/post/${post.id}`} className="absolute inset-0" aria-label={t(ctx.locale, "post.open")} />}
      {item.recastBy && (
        <p className="relative z-10 mb-1.5 ml-[30px] flex items-center gap-1.5 text-[13px] font-medium text-faint">
          <Repeat2 size={14} />
          <Link href={`/u/${item.recastBy.handle}`} className="hover:underline">{item.recastBy.name}</Link> {t(ctx.locale, "post.recasted")}
        </p>
      )}
      <div className="flex gap-3">
        <div className="relative flex flex-col items-center">
          {(connector === "top" || connector === "both") && <span className="absolute -top-4 h-4 w-0.5 bg-line-strong" />}
          <Link href={`/u/${post.author.handle}`} className="relative z-10">
            <UserAvatar name={post.author.name} seed={post.author.handle} size={focus ? 48 : 42} />
          </Link>
          {(connector === "bottom" || connector === "both") && <span className="mt-1 w-0.5 flex-1 bg-line-strong" />}
        </div>
        <div className="min-w-0 flex-1 pb-0.5">
          <AuthorLine author={post.author} at={post.createdAt} locale={ctx.locale} />
          {focus && (post.author.headline || post.author.orgName) && (
            <p className="truncate text-[13px] text-faint">{[post.author.headline, post.author.orgName].filter(Boolean).join(" @ ")}</p>
          )}
          {post.parent && variant === "feed" && (
            <p className="flex items-center gap-1 text-[13px] text-faint">
              <CornerDownRight size={13} /> {t(ctx.locale, "post.replyingTo")}{" "}
              <Link href={`/u/${post.parent.author.handle}`} className="relative z-10 text-accent">@{post.parent.author.handle}</Link>
            </p>
          )}
          {(post.kind || post.channel) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <PostKindChip kind={post.kind} locale={ctx.locale} />
              {post.channel && (
                <Link href={`/channels/${post.channel.slug}`} className="relative z-10 inline-flex items-center gap-0.5 text-[12px] font-medium text-faint hover:text-accent">
                  <Hash size={12} />{post.channel.slug}
                </Link>
              )}
            </div>
          )}
          <p className={`mt-1 whitespace-pre-wrap break-words leading-relaxed ${focus ? "text-[18px]" : "text-[15px]"}`}>
            <RichText body={post.body} known={ctx.known} />
          </p>
          {post.quoteOf && <QuoteEmbed post={post.quoteOf} ctx={ctx} />}
          {post.orgs.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {post.orgs.map(({ org }) => (
                <Link key={org.slug} href={`/orgs/${org.slug}`} className="relative z-10 inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-muted transition hover:border-line-strong hover:text-fg">
                  <OrgLogo slug={org.slug} name={org.name} size={18} />
                  {org.name}
                </Link>
              ))}
            </div>
          )}
          {focus && (
            <p className="mt-3 text-sm text-faint">
              {post.createdAt.toLocaleString(ctx.locale === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
          <PostActions
            postId={post.id}
            locale={ctx.locale}
            counts={{ replies: post._count.replies, recasts: post._count.recasts, likes: post._count.likes }}
            liked={post.likes.length > 0}
            recasted={post.recasts.length > 0}
            channels={ctx.channels}
            viewerAvatar={<UserAvatar name={ctx.viewer.name} seed={ctx.viewer.handle} size={42} />}
            quotePreview={
              <div className="rounded-2xl border border-line p-3">
                <div className="flex items-center gap-2 text-[13px]">
                  <UserAvatar name={post.author.name} seed={post.author.handle} size={20} />
                  <span className="font-semibold">{post.author.name}</span>
                  <span className="text-faint">@{post.author.handle}</span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-[14px] text-fg/90">{post.body}</p>
              </div>
            }
          />
        </div>
      </div>
    </article>
  );
}
