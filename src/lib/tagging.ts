import { parseList } from "./json";

export interface TaggableOrg {
  id: string;
  name: string;
  aliases: string; // JSON string[]
}

/** Terms shorter than this are ignored unless they are all-caps acronyms (e.g. "EY", "BNY"). */
const MIN_TERM = 4;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termsFor(org: TaggableOrg): string[] {
  const terms = [org.name, ...parseList(org.aliases)].map((t) => t.trim()).filter(Boolean);
  return [...new Set(terms)];
}

function isAcronym(term: string) {
  return /^[A-Z0-9&]{2,}$/.test(term);
}

/**
 * Finds organisations mentioned in a piece of text by whole-word match on the
 * org name or any alias. Matching is case-sensitive because org names are
 * proper nouns — this avoids false positives like "circle back", "ice" or
 * "they". Short non-acronym terms are ignored entirely.
 */
export function matchOrgs<T extends TaggableOrg>(text: string, orgs: T[]): T[] {
  if (!text.trim()) return [];
  const hits: T[] = [];
  for (const org of orgs) {
    const matched = termsFor(org).some((term) => {
      const acronym = isAcronym(term);
      if (!acronym && term.length < MIN_TERM) return false;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?=$|[^\\p{L}\\p{N}])`, "u");
      return re.test(text);
    });
    if (matched) hits.push(org);
  }
  return hits;
}

/** Extracts explicit `$slug` tags from a cast-like post body. */
export function extractCashtags(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|\s)\$([a-z0-9][a-z0-9-]{1,40})/gi)) out.add(m[1].toLowerCase());
  return [...out];
}
