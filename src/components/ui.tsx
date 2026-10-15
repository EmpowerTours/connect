import Link from "next/link";
import type { ReactNode } from "react";
import { ORG_TYPE_LABELS, t, type Locale } from "@/lib/i18n";
import type { DueStatus, Stage } from "@/lib/pipeline";

export function OrgTypeBadge({ type, locale }: { type: string; locale: Locale }) {
  return <span className="chip">{ORG_TYPE_LABELS[locale][type] ?? type}</span>;
}

export const STAGE_COLORS: Record<Stage, string> = {
  awareness: "bg-faint",
  evaluation: "bg-accent",
  pilot: "bg-amber-400",
  committed: "bg-success",
  lost: "bg-danger",
};

export function StageDot({ stage }: { stage: Stage }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${STAGE_COLORS[stage]}`} />;
}

const DUE_COLORS: Record<DueStatus, string> = {
  overdue: "border-red-300 text-red-700 bg-red-50",
  today: "border-amber-300 text-amber-800 bg-amber-50",
  soon: "border-accent/40 text-accent-ink",
  later: "border-line text-muted",
  none: "border-line text-faint",
};

export function DueChip({ status, date, locale }: { status: DueStatus; date: Date | null; locale: Locale }) {
  const label = t(locale, `due.${status}`);
  const d = date ? date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric" }) : "";
  return <span className={`chip ${DUE_COLORS[status]}`}>{d ? `${label} · ${d}` : label}</span>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

export function VerifiedBadge({ verified, locale }: { verified: boolean; locale: Locale }) {
  return verified ? (
    <span title={t(locale, "profile.verified")} className="text-accent">✓</span>
  ) : (
    <span title={t(locale, "profile.verifyHint")} className="chip border-dashed text-faint">
      {t(locale, "profile.unverified")}
    </span>
  );
}

export function OrgChip({ slug, name }: { slug: string; name: string }) {
  return (
    <Link href={`/orgs/${slug}`} className="chip hover:border-accent hover:text-white">
      ${name}
    </Link>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function timeAgo(date: Date, locale: Locale, now = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat(locale === "es" ? "es" : "en", { numeric: "auto", style: "short" });
  const s = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}
