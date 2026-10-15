import type { Locale } from "@/lib/i18n";

export function timeAgo(date: Date, locale: Locale, now = new Date()): string {
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  const es = locale === "es";
  if (s < 0) {
    return date.toLocaleDateString(es ? "es-MX" : "en-US", { month: "short", day: "numeric" });
  }
  if (s < 60) return es ? "ahora" : "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return date.toLocaleDateString(es ? "es-MX" : "en-US", { month: "short", day: "numeric" });
}
