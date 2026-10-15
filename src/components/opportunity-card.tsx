import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DemoBadge } from "@/components/badges";
import { REGION_LABELS, t, type Locale } from "@/lib/i18n";
import { orgInitial } from "@/lib/opportunities";

export interface OpportunityView {
  id: string;
  kind: string;
  headline: string;
  body: string;
  region: string;
  orgName: string;
  author: { name: string; handle: string; isDemo: boolean };
  /** "self" | "connected" | "intro" (with via) | "none" */
  path: { kind: "self" | "connected" | "intro" | "none"; viaName?: string; viaHandle?: string };
}

export function OpportunityCard({ o, locale, index }: { o: OpportunityView; locale: Locale; index: number }) {
  const ask = o.kind === "ask";
  const action =
    o.path.kind === "intro"
      ? { href: `/u/${o.author.handle}?intro=1${o.path.viaHandle ? `&via=${o.path.viaHandle}` : ""}`, label: t(locale, "opps.requestIntro") }
      : o.path.kind === "none"
        ? { href: `/u/${o.author.handle}?intro=1`, label: t(locale, "opps.requestIntro") }
        : { href: `/u/${o.author.handle}`, label: t(locale, "opps.viewProfile") };
  const note =
    o.path.kind === "intro" ? t(locale, "opps.via").replace("{name}", o.path.viaName ?? "")
    : o.path.kind === "connected" ? t(locale, "opps.connected")
    : o.path.kind === "self" ? t(locale, "opps.yours")
    : t(locale, "opps.noPath");
  return (
    <article
      className="relative snap-start rounded-[26px] border border-white/90 p-5 pb-5 shadow-[0_1px_2px_rgb(23_21_31/0.04),0_-6px_24px_-14px_rgb(76_29_149/0.22)] backdrop-blur-xl animate-rise"
      style={{
        background: ask
          ? "linear-gradient(160deg, rgb(243 238 255 / 0.95) 0%, rgb(255 255 255 / 0.92) 70%)"
          : "linear-gradient(160deg, rgb(255 255 255 / 0.95) 0%, rgb(248 246 252 / 0.92) 100%)",
        animationDelay: `${Math.min(index, 6) * 40}ms`,
        animationFillMode: "backwards",
      }}
    >
      <div className="flex gap-4">
        <span
          aria-hidden
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[19px] font-semibold ${ask ? "bg-accent-soft text-accent-ink" : "border border-line bg-white text-muted"}`}
        >
          {orgInitial(o.orgName || o.author.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
            <span className={ask ? "text-accent-ink" : "text-faint"}>{t(locale, ask ? "opps.ask" : "opps.offer")}</span>
            {o.author.isDemo && <DemoBadge locale={locale} />}
          </div>
          <h3 className="mt-1 text-[16.5px] font-semibold leading-snug tracking-[-0.005em] text-fg">{o.headline}</h3>
          {o.region && (
            <span className="mt-2 inline-flex rounded-full border border-line bg-white/80 px-2.5 py-0.5 text-[12px] font-medium text-muted">
              {REGION_LABELS[locale][o.region] ?? o.region}
            </span>
          )}
          {o.body && <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{o.body}</p>}
          <div className="mt-4 flex items-center justify-between gap-3">
            {o.path.kind === "self" ? (
              <span className="text-[13px] font-medium text-faint">{note}</span>
            ) : (
              <>
                <Link href={action.href} className="btn-pill">
                  {action.label} <ArrowRight size={15} />
                </Link>
                <span className="truncate text-[12.5px] text-faint">{note}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
