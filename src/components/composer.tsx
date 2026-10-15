"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { BriefcaseBusiness, Hash, Rocket, Search, Sparkles } from "lucide-react";
import { createPostAction } from "@/app/actions";
import { POST_MAX_LENGTH } from "@/lib/constants";
import { t, type Locale } from "@/lib/i18n";
import { POST_KINDS, type PostKind } from "@/lib/posts";

const KIND_ICONS: Record<PostKind, typeof Search> = { looking_for_partner: Search, launch: Rocket, hiring: BriefcaseBusiness, insight: Sparkles };

function Ring({ used }: { used: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, used / POST_MAX_LENGTH);
  const left = POST_MAX_LENGTH - used;
  const color = left < 0 ? "var(--color-danger)" : left <= 20 ? "#fbbf24" : "var(--color-accent)";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-faint">
      {left <= 40 && <span style={{ color }}>{left}</span>}
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="2.5" />
        <circle cx="11" cy="11" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" transform="rotate(-90 11 11)" />
      </svg>
    </span>
  );
}

export interface ComposerProps {
  locale: Locale;
  channels: { slug: string; name: string }[];
  parentId?: string;
  quoteOfId?: string;
  defaultChannel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  redirectTo?: string;
  onDone?: () => void;
  author: React.ReactNode;
}

export function Composer({ locale, channels, parentId, quoteOfId, defaultChannel = "", placeholder, autoFocus, compact, redirectTo, onDone, author }: ComposerProps) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<PostKind | "">("");
  const [channel, setChannel] = useState(defaultChannel);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const used = [...body].length;
  const isReply = Boolean(parentId);

  const submit = () => {
    const fd = new FormData();
    fd.set("body", body);
    fd.set("kind", kind);
    fd.set("channel", channel);
    if (parentId) fd.set("parentId", parentId);
    if (quoteOfId) fd.set("quoteOfId", quoteOfId);
    start(async () => {
      const res = await createPostAction(fd);
      if (!res.ok) {
        setError(res.error === "too_long" ? t(locale, "composer.tooLong") : t(locale, "composer.empty"));
        return;
      }
      setBody("");
      setKind("");
      setError(null);
      onDone?.();
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  };

  return (
    <div className={`flex gap-3 ${compact ? "" : "px-4 py-3"}`}>
      {author}
      <div className="min-w-0 flex-1">
        <textarea
          ref={ref}
          value={body}
          autoFocus={autoFocus}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && used > 0 && used <= POST_MAX_LENGTH) submit();
          }}
          rows={compact ? 2 : 3}
          placeholder={placeholder ?? t(locale, isReply ? "composer.replyPlaceholder" : "composer.placeholder")}
          aria-label={t(locale, "composer.placeholder")}
          className="w-full resize-none bg-transparent pt-1.5 text-[17px] leading-relaxed outline-none placeholder:text-faint"
        />
        {!isReply && (
          <div className="no-scrollbar -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1">
            {POST_KINDS.map((k) => {
              const Icon = KIND_ICONS[k];
              const on = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(on ? "" : k)}
                  aria-pressed={on}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-95 ${
                    on ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <Icon size={12} />
                  {t(locale, `kind.${k}`)}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
          {!isReply ? (
            <label className="inline-flex min-w-0 items-center gap-1 rounded-full px-1 text-sm text-muted">
              <Hash size={15} className="shrink-0 text-accent" />
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className="min-w-0 max-w-[160px] bg-transparent py-1 text-sm text-muted outline-none" aria-label={t(locale, "composer.channel")}>
                <option value="">{t(locale, "composer.noChannel")}</option>
                {channels.map((c) => (
                  <option key={c.slug} value={c.slug}>/{c.slug}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-xs text-faint">{t(locale, "composer.hint")}</span>
          )}
          <div className="flex items-center gap-3">
            {used > 0 && <Ring used={used} />}
            <button type="button" onClick={submit} disabled={pending || used === 0 || used > POST_MAX_LENGTH} className="btn-primary h-9 px-5">
              {pending ? "…" : t(locale, isReply ? "composer.reply" : "composer.cast")}
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
