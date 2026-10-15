"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Quote, Repeat2, X } from "lucide-react";
import { toggleLikeAction, toggleRecastAction } from "@/app/actions";
import { t, type Locale } from "@/lib/i18n";
import { Composer } from "./composer";

interface Props {
  postId: string;
  locale: Locale;
  counts: { replies: number; recasts: number; likes: number };
  liked: boolean;
  recasted: boolean;
  channels: { slug: string; name: string }[];
  quotePreview: React.ReactNode;
  viewerAvatar: React.ReactNode;
}

export function PostActions({ postId, locale, counts, liked, recasted, channels, quotePreview, viewerAvatar }: Props) {
  const [state, setState] = useOptimistic({ liked, recasted, likes: counts.likes, recasts: counts.recasts }, (s, a: "like" | "recast") =>
    a === "like" ? { ...s, liked: !s.liked, likes: s.likes + (s.liked ? -1 : 1) } : { ...s, recasted: !s.recasted, recasts: s.recasts + (s.recasted ? -1 : 1) },
  );
  const [, start] = useTransition();
  const [menu, setMenu] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [popKey, setPopKey] = useState(0);

  const like = () =>
    start(async () => {
      setState("like");
      if (!state.liked) setPopKey((k) => k + 1);
      await toggleLikeAction(postId);
    });
  const recast = () =>
    start(async () => {
      setMenu(false);
      setState("recast");
      await toggleRecastAction(postId);
    });

  const btn = "group/act relative z-10 inline-flex items-center gap-1.5 rounded-full py-1 pr-2 text-[13px] tabular-nums transition";
  return (
    <div className={`relative -ml-2 ${menu ? "z-40" : "z-10"} mt-2 flex max-w-sm items-center justify-between text-faint`}>
      <Link href={`/post/${postId}#reply`} className={`${btn} hover:text-accent`} aria-label={t(locale, "post.reply")}>
        <span className="rounded-full p-1.5 transition group-hover/act:bg-accent-soft"><MessageCircle size={17} /></span>
        {counts.replies > 0 && counts.replies}
      </Link>
      <div className="relative">
        <button type="button" onClick={() => setMenu((m) => !m)} className={`${btn} ${state.recasted ? "text-success" : "hover:text-success"}`} aria-label={t(locale, "post.recast")} aria-expanded={menu}>
          <span className="rounded-full p-1.5 transition group-hover/act:bg-success/10"><Repeat2 size={18} /></span>
          {state.recasts > 0 && state.recasts}
        </button>
        {menu && (
          <>
            <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setMenu(false)} />
            <div className="absolute left-0 top-9 z-30 w-44 overflow-hidden rounded-xl border border-line-strong bg-raised py-1 shadow-2xl animate-fade-in">
              <button type="button" onClick={recast} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-fg hover:bg-black/[0.03]">
                <Repeat2 size={16} /> {state.recasted ? t(locale, "post.undoRecast") : t(locale, "post.recast")}
              </button>
              <button type="button" onClick={() => { setMenu(false); setQuoting(true); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-fg hover:bg-black/[0.03]">
                <Quote size={16} /> {t(locale, "post.quote")}
              </button>
            </div>
          </>
        )}
      </div>
      <button type="button" onClick={like} className={`${btn} ${state.liked ? "text-pink-500" : "hover:text-pink-500"}`} aria-label={t(locale, "post.like")} aria-pressed={state.liked}>
        <span key={popKey} className={`rounded-full p-1.5 transition group-hover/act:bg-pink-500/10 ${popKey ? "animate-pop" : ""}`}>
          <Heart size={17} fill={state.liked ? "currentColor" : "none"} />
        </span>
        {state.likes > 0 && state.likes}
      </button>
      <span className="w-8" />
      {quoting && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/30 p-3 pt-[10vh] backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
          <div className="card w-full max-w-[560px] p-2 text-fg animate-rise">
            <div className="flex items-center justify-between px-2 py-1">
              <button type="button" onClick={() => setQuoting(false)} className="btn-ghost h-9 w-9 p-0" aria-label="Close"><X size={18} /></button>
              <span className="text-sm font-semibold">{t(locale, "post.quote")}</span>
              <span className="w-9" />
            </div>
            <Composer locale={locale} channels={channels} quoteOfId={postId} autoFocus author={viewerAvatar} onDone={() => setQuoting(false)} placeholder={t(locale, "composer.quotePlaceholder")} />
            <div className="mx-4 mb-3 ml-[68px]">{quotePreview}</div>
          </div>
        </div>
      )}
    </div>
  );
}
