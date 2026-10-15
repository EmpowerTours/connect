/** Pure onboarding rules (validated server-side; unit tested). */
import { REGIONS, type Region } from "./constants";
import { parseList } from "./json";
import { normalizeLinkedIn, normalizeWebUrl, normalizeXHandle } from "./links";

export const FOCUS_TAGS = [
  "stablecoins",
  "payments",
  "remittances",
  "custody",
  "tokenization",
  "rwa",
  "treasury",
  "market_infra",
  "compliance",
  "defi",
  "wallets",
  "infrastructure",
] as const;
export type FocusTag = (typeof FOCUS_TAGS)[number];
export const MAX_FOCUS_TAGS = 5;

export const ONBOARDING_STEPS = ["you", "org", "focus", "profile", "first"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isFocusTag(v: string): v is FocusTag {
  return (FOCUS_TAGS as readonly string[]).includes(v);
}

export type BasicsError = "name_empty" | "name_long" | "headline_empty" | "headline_long";

export function validateBasics(input: { name: string; headline: string }):
  | { ok: true; value: { name: string; headline: string } }
  | { ok: false; error: BasicsError } {
  const name = input.name.trim().replace(/\s+/g, " ");
  const headline = input.headline.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "name_empty" };
  if ([...name].length > 80) return { ok: false, error: "name_long" };
  if ([...headline].length < 2) return { ok: false, error: "headline_empty" };
  if ([...headline].length > 100) return { ok: false, error: "headline_long" };
  return { ok: true, value: { name, headline } };
}

export type FocusError = "region" | "tags_empty" | "tags_many" | "tag";

export function validateFocus(input: { region: string; tags: string[] }):
  | { ok: true; value: { region: Region; tags: FocusTag[] } }
  | { ok: false; error: FocusError } {
  if (!(REGIONS as readonly string[]).includes(input.region)) return { ok: false, error: "region" };
  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
  if (tags.some((t) => !isFocusTag(t))) return { ok: false, error: "tag" };
  if (tags.length === 0) return { ok: false, error: "tags_empty" };
  if (tags.length > MAX_FOCUS_TAGS) return { ok: false, error: "tags_many" };
  return { ok: true, value: { region: input.region as Region, tags: tags as FocusTag[] } };
}

export type LinksError = "x" | "linkedin" | "website";

export function validateLinks(input: { x: string; linkedin: string; website: string }):
  | { ok: true; value: { linkX: string; linkLinkedin: string; linkWebsite: string } }
  | { ok: false; error: LinksError } {
  const x = normalizeXHandle(input.x);
  if (!x.ok) return { ok: false, error: "x" };
  const li = normalizeLinkedIn(input.linkedin);
  if (!li.ok) return { ok: false, error: "linkedin" };
  const web = normalizeWebUrl(input.website);
  if (!web.ok) return { ok: false, error: "website" };
  return { ok: true, value: { linkX: x.value, linkLinkedin: li.value, linkWebsite: web.value } };
}

/** Org step: an existing org (matched by name, case-insensitive), a new one to request, or none. */
export function resolveOrgChoice(
  raw: string,
  orgs: { id: string; name: string }[],
): { kind: "none" } | { kind: "existing"; orgId: string; name: string } | { kind: "new"; name: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { kind: "none" };
  const hit = orgs.find((o) => o.name.toLowerCase() === name.toLowerCase());
  return hit ? { kind: "existing", orgId: hit.id, name: hit.name } : { kind: "new", name: name.slice(0, 80) };
}

interface ProfileLike {
  name: string;
  headline: string;
  orgName: string;
  region: string;
  focusTags: string;
  onboardedAt: Date | null;
  isDemo: boolean;
}

export function needsOnboarding(u: Pick<ProfileLike, "onboardedAt" | "isDemo">): boolean {
  return !u.isDemo && !u.onboardedAt;
}

export function profileComplete(u: ProfileLike): boolean {
  return !!u.name.trim() && !!u.headline.trim() && !!u.orgName.trim() && !!u.region && parseList(u.focusTags).length > 0;
}

export interface ChecklistState {
  profileComplete: boolean;
  claimStatus: "none" | "pending" | "approved";
  opportunities: number;
  connections: number;
}

export type ChecklistKey = "profile" | "claim" | "ask" | "connect";
export interface ChecklistItem {
  key: ChecklistKey;
  done: boolean;
  /** Claim submitted but not yet approved. */
  pending?: boolean;
  href: string;
}

/** Today's "get started" checklist for a new member. */
export function onboardingChecklist(s: ChecklistState): { items: ChecklistItem[]; done: number; total: number; complete: boolean } {
  const items: ChecklistItem[] = [
    { key: "profile", done: s.profileComplete, href: "/welcome?step=you" },
    { key: "claim", done: s.claimStatus === "approved", pending: s.claimStatus === "pending", href: "/orgs" },
    { key: "ask", done: s.opportunities > 0, href: "/opportunities?new=1" },
    { key: "connect", done: s.connections > 0, href: "/circle" },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length };
}

/** Error codes the onboarding/profile actions redirect with (whitelisted before display). */
export const ONBOARDING_ERRORS = [
  "name_empty", "name_long", "headline_empty", "headline_long", "body_long", "kind",
  "org_name_empty", "org_name_long", "org_website", "org_type", "org_exists",
  "region", "tags_empty", "tags_many", "tag",
  "link_x", "link_linkedin", "link_website",
  "photo_empty", "photo_too_large", "photo_type", "photo_dimensions", "photo_corrupt",
] as const;
export type OnboardingError = (typeof ONBOARDING_ERRORS)[number];
export function isOnboardingError(v: string | undefined): v is OnboardingError {
  return !!v && (ONBOARDING_ERRORS as readonly string[]).includes(v);
}
