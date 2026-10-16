/** Helpers for list fields stored as JSON strings (SQLite-friendly). */
export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Intentional: a corrupt stored list reads as empty rather than breaking the page.
    return [];
  }
}

/** Normalises comma-separated user input or an array into a de-duplicated JSON list. */
export function toList(input: string | string[]): string {
  const items = (Array.isArray(input) ? input : input.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return JSON.stringify(out);
}
