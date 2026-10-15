import type { Locale } from "./i18n";

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

const GREETINGS: Record<Locale, Record<DayPart, string>> = {
  en: { morning: "Morning", afternoon: "Afternoon", evening: "Evening" },
  es: { morning: "Buenos días", afternoon: "Buenas tardes", evening: "Buenas noches" },
};

export function greeting(hour: number, locale: Locale): string {
  return GREETINGS[locale][dayPart(hour)];
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export interface InsightSignal {
  orgSlug: string;
  orgName: string;
  title: string;
  sourceName: string;
  url: string | null;
  publishedAt: Date;
}

export interface Insight {
  orgSlug: string;
  orgName: string;
  count: number;
  latest: InsightSignal;
  inPipeline: boolean;
}

/**
 * Hero insight for Today: the organization with the most public news signals in the window,
 * boosted when it is in your deals or followed. Only reports what the signals say.
 */
export function pickInsight(signals: InsightSignal[], priorityOrgSlugs: Set<string>, now = new Date(), windowDays = 7): Insight | null {
  const since = now.getTime() - windowDays * 86_400_000;
  const byOrg = new Map<string, InsightSignal[]>();
  for (const s of signals) {
    if (s.publishedAt.getTime() < since || s.publishedAt.getTime() > now.getTime() + 60_000) continue;
    byOrg.set(s.orgSlug, [...(byOrg.get(s.orgSlug) ?? []), s]);
  }
  let best: Insight | null = null;
  let bestScore = -1;
  for (const [slug, list] of byOrg) {
    list.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    const inPipeline = priorityOrgSlugs.has(slug);
    const score = list.length + (inPipeline ? 3 : 0) + list[0].publishedAt.getTime() / 1e15;
    if (score > bestScore) {
      bestScore = score;
      best = { orgSlug: slug, orgName: list[0].orgName, count: list.length, latest: list[0], inPipeline };
    }
  }
  return best;
}
