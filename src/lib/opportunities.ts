import { REGIONS, type Region } from "./constants";
import { isFocusTag, type FocusTag } from "./onboarding";

export const OPPORTUNITY_KINDS = ["ask", "offer"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export const OPP_HEADLINE_MAX = 90;
export const OPP_BODY_MAX = 220;

export const OPP_STATUSES = ["open", "filled", "closed"] as const;
export type OpportunityStatus = (typeof OPP_STATUSES)[number];

/** How long a post stays up. Expired posts drop out of the list; the author can repost. */
export const OPP_EXPIRY_DAYS = [7, 14, 30, 60, 90] as const;
export const DEFAULT_EXPIRY_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface OpportunityInput {
  kind: string;
  headline: string;
  body: string;
  region: string;
  /** A focus tag or "" (optional). */
  topic?: string;
  /** One of OPP_EXPIRY_DAYS as a string/number; defaults to DEFAULT_EXPIRY_DAYS. */
  expiresInDays?: string | number;
}

export type OpportunityError = "kind" | "headline_empty" | "headline_long" | "body_long" | "region" | "topic" | "expiry";

export interface OpportunityValue {
  kind: OpportunityKind;
  headline: string;
  body: string;
  region: Region | "";
  topic: FocusTag | "";
  expiresAt: Date;
}

export function validateOpportunity(
  input: OpportunityInput,
  now: Date = new Date(),
): { ok: true; value: OpportunityValue } | { ok: false; error: OpportunityError } {
  const headline = input.headline.trim().replace(/\s+/g, " ");
  const body = input.body.trim();
  const topic = (input.topic ?? "").trim();
  const daysRaw = input.expiresInDays === undefined || input.expiresInDays === "" ? DEFAULT_EXPIRY_DAYS : Number(input.expiresInDays);
  if (!(OPPORTUNITY_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "kind" };
  if (!headline) return { ok: false, error: "headline_empty" };
  if ([...headline].length > OPP_HEADLINE_MAX) return { ok: false, error: "headline_long" };
  if ([...body].length > OPP_BODY_MAX) return { ok: false, error: "body_long" };
  if (input.region && !(REGIONS as readonly string[]).includes(input.region)) return { ok: false, error: "region" };
  if (topic && !isFocusTag(topic)) return { ok: false, error: "topic" };
  if (!(OPP_EXPIRY_DAYS as readonly number[]).includes(daysRaw)) return { ok: false, error: "expiry" };
  return {
    ok: true,
    value: {
      kind: input.kind as OpportunityKind,
      headline,
      body,
      region: input.region as Region | "",
      topic: topic as FocusTag | "",
      expiresAt: new Date(now.getTime() + daysRaw * DAY),
    },
  };
}

export interface OpportunityLike {
  status: string;
  hidden: boolean;
  expiresAt: Date | null;
  authorId: string;
}

/** Shown in the shared list: open, not hidden by moderation, not expired. */
export function isLive(o: Omit<OpportunityLike, "authorId">, now: Date = new Date()): boolean {
  return o.status === "open" && !o.hidden && (!o.expiresAt || o.expiresAt.getTime() > now.getTime());
}

/** Prisma filter matching isLive(). */
export function liveWhere(now: Date = new Date()) {
  return { status: "open", hidden: false, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/** Display state for the author: live | expired | filled | closed | hidden. */
export function displayState(o: Omit<OpportunityLike, "authorId">, now: Date = new Date()): "live" | "expired" | "filled" | "closed" | "hidden" {
  if (o.hidden) return "hidden";
  if (o.status === "filled" || o.status === "closed") return o.status;
  return o.expiresAt && o.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
}

export type OpportunityAction = "edit" | "fill" | "close" | "reopen";

/**
 * Lifecycle (author only; hidden posts are frozen until an admin restores them):
 *   open --fill--> filled      open --close--> closed      open --edit--> open
 *   filled|closed|expired --reopen--> open (with a fresh expiry)
 */
export function applyOpportunityAction(
  o: OpportunityLike,
  action: OpportunityAction,
  actorId: string,
  now: Date = new Date(),
): { ok: true; status: OpportunityStatus } | { ok: false; error: "not_owner" | "hidden" | "state" } {
  if (actorId !== o.authorId) return { ok: false, error: "not_owner" };
  if (o.hidden) return { ok: false, error: "hidden" };
  const live = isLive(o, now);
  switch (action) {
    case "edit":
      return o.status === "open" ? { ok: true, status: "open" } : { ok: false, error: "state" };
    case "fill":
    case "close":
      return live ? { ok: true, status: action === "fill" ? "filled" : "closed" } : { ok: false, error: "state" };
    case "reopen":
      return live ? { ok: false, error: "state" } : { ok: true, status: "open" };
  }
}

/* ---------- direct intro requests on an opportunity ---------- */

export type DirectIntroError = "self" | "not_live" | "connected" | "duplicate" | "reason_empty" | "reason_long";
export const INTRO_REASON_MAX = 300;

/**
 * A member asks an opportunity's author directly (no mutual connector needed).
 * The author accepts or declines; accepting connects the two.
 */
export function validateDirectIntro(input: {
  requesterId: string;
  opportunity: OpportunityLike;
  reason: string;
  alreadyConnected: boolean;
  /** Intros the requester already has to the author. */
  existing: { status: string; opportunityId: string | null }[];
  now?: Date;
}): DirectIntroError | null {
  const { requesterId, opportunity: o } = input;
  if (requesterId === o.authorId) return "self";
  if (!isLive(o, input.now)) return "not_live";
  if (input.alreadyConnected) return "connected";
  if (input.existing.some((i) => i.status === "pending")) return "duplicate";
  const reason = input.reason.trim();
  if (!reason) return "reason_empty";
  if ([...reason].length > INTRO_REASON_MAX) return "reason_long";
  return null;
}

/* ---------- reports / moderation ---------- */

export const REPORT_REASONS = ["spam", "misleading", "impersonation", "offensive", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const isReportReason = (v: string): v is ReportReason => (REPORT_REASONS as readonly string[]).includes(v);

export function validateReport(input: { reporterId: string; authorId: string; reason: string; note: string }):
  | { ok: true; value: { reason: ReportReason; note: string } }
  | { ok: false; error: "self" | "reason" | "note_long" } {
  if (input.reporterId === input.authorId) return { ok: false, error: "self" };
  if (!isReportReason(input.reason)) return { ok: false, error: "reason" };
  const note = input.note.trim();
  if ([...note].length > 500) return { ok: false, error: "note_long" };
  return { ok: true, value: { reason: input.reason as ReportReason, note } };
}

export type ModerationDecision = "hide" | "dismiss";

/** Report decisions: only open reports can be decided. Hiding marks the report "actioned". */
export function applyReportDecision(status: string, decision: ModerationDecision): { ok: true; status: "actioned" | "dismissed" } | { ok: false } {
  if (status !== "open") return { ok: false };
  return { ok: true, status: decision === "hide" ? "actioned" : "dismissed" };
}

/** First letter for the org tile ("Banco Meridiano" → "B"). */
export function orgInitial(name: string): string {
  const m = name.trim().match(/\p{L}|\p{N}/u);
  return m ? m[0].toUpperCase() : "?";
}
