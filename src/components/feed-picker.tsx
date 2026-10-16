import Link from "next/link";
import { SlidersHorizontal, Sparkles, VolumeX } from "lucide-react";
import { setFeedAlgorithmAction, setFeedMutesAction } from "@/app/feed-actions";
import { listFeedAlgorithms, type FeedAlgorithm } from "@/lib/feed-algorithms";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { FOCUS_TAGS } from "@/lib/onboarding";

const chip = (on: boolean) =>
  `shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
    on ? "border-accent bg-accent text-white shadow-[0_6px_16px_-8px_rgb(124_58_237/0.7)]" : "border-line bg-white/70 text-muted hover:border-lilac hover:text-fg"
  }`;
const toggle =
  "inline-flex cursor-pointer select-none items-center rounded-full border border-line bg-white/70 px-3 py-1 text-[12.5px] font-medium text-muted transition hover:border-lilac peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-accent";

/**
 * Feed picker: the algorithm chips, a one-line "what this feed does", and a
 * Tune panel for topic/channel mutes. Works without client JS (forms and a
 * <details> disclosure), like the rest of the app.
 *
 * `save` mode persists the choice on the member (Updates). `link` mode only
 * changes the view (?feed=) — used on channels, which have their own default.
 */
export function FeedPicker({
  locale,
  active,
  mode,
  channelDefault,
  mutes,
  channels,
}: {
  locale: Locale;
  active: FeedAlgorithm;
  mode: { kind: "save"; back: string } | { kind: "link"; base: string };
  channelDefault?: string;
  mutes: { topics: string[]; channels: string[] };
  channels: { slug: string; name: string }[];
}) {
  const algs = listFeedAlgorithms();
  const mutedLabels = [...mutes.topics.map((x) => t(locale, `focus.${x}` as MessageKey)), ...mutes.channels.map((c) => `/${c}`)];
  const back = mode.kind === "save" ? mode.back : mode.base;
  return (
    <div className="border-b border-line bg-white/60 px-4 pb-3 pt-3" data-testid="feed-picker">
      <div className="flex items-center gap-2">
        <span className="eyebrow shrink-0">{t(locale, "feed.picker")}</span>
        <div className="no-scrollbar -mr-4 flex flex-1 gap-2 overflow-x-auto pr-4" role="radiogroup" aria-label={t(locale, "feed.picker")}>
          {algs.map((a) =>
            mode.kind === "save" ? (
              <form key={a.id} action={setFeedAlgorithmAction} className="shrink-0">
                <input type="hidden" name="algorithm" value={a.id} />
                <input type="hidden" name="back" value={mode.back} />
                <button role="radio" aria-checked={a.id === active.id} className={chip(a.id === active.id)}>
                  {a.label[locale]}
                </button>
              </form>
            ) : (
              <Link key={a.id} href={`${mode.base}?feed=${a.id}`} scroll={false} role="radio" aria-checked={a.id === active.id} className={chip(a.id === active.id)}>
                {a.label[locale]}
                {channelDefault === a.id && <span className="ml-1 font-medium opacity-80">· {t(locale, "feed.channelDefault")}</span>}
              </Link>
            ),
          )}
        </div>
      </div>
      <details className="group mt-2.5">
        <summary className="flex cursor-pointer list-none items-start gap-2 text-[13px] text-muted [&::-webkit-details-marker]:hidden">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            {active.description[locale]}
            {mutedLabels.length > 0 && (
              <span className="mt-0.5 flex items-center gap-1 text-faint">
                <VolumeX size={12} /> {t(locale, "feed.muting")} {mutedLabels.join(", ")}
              </span>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-semibold text-accent-ink">
            <SlidersHorizontal size={12} /> {t(locale, "feed.tune")}
          </span>
        </summary>
        <form action={setFeedMutesAction} className="glass mt-3 space-y-3 rounded-[20px]! p-3.5">
          <input type="hidden" name="back" value={back} />
          <p className="text-[13px] font-semibold">{t(locale, "feed.muteTopics")}</p>
          <div className="flex flex-wrap gap-1.5">
            {FOCUS_TAGS.map((tag) => (
              <label key={tag}>
                <input type="checkbox" name="topics" value={tag} defaultChecked={mutes.topics.includes(tag)} className="peer sr-only" />
                <span className={toggle}>{t(locale, `focus.${tag}` as MessageKey)}</span>
              </label>
            ))}
          </div>
          {channels.length > 0 && (
            <>
              <p className="text-[13px] font-semibold">{t(locale, "feed.muteChannels")}</p>
              <div className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <label key={c.slug}>
                    <input type="checkbox" name="channels" value={c.slug} defaultChecked={mutes.channels.includes(c.slug)} className="peer sr-only" />
                    <span className={toggle}>/{c.slug}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="sticky-actions -mx-3.5 -mb-3.5 flex items-center gap-3 rounded-b-[20px] px-3.5 py-3" data-testid="feed-mutes-actions">
            <p className="min-w-0 flex-1 text-[12px] text-faint">{t(locale, "feed.muteHint")}</p>
            <button className="btn-primary h-9 shrink-0 text-[13px]">{t(locale, "feed.saveMutes")}</button>
          </div>
        </form>
      </details>
    </div>
  );
}
