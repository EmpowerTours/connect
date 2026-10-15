import { REGIONS, type Region } from "./constants";

export const OPPORTUNITY_KINDS = ["ask", "offer"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export const OPP_HEADLINE_MAX = 90;
export const OPP_BODY_MAX = 220;

export interface OpportunityInput {
  kind: string;
  headline: string;
  body: string;
  region: string;
}

export type OpportunityError = "kind" | "headline_empty" | "headline_long" | "body_long" | "region";

export function validateOpportunity(input: OpportunityInput): { ok: true; value: { kind: OpportunityKind; headline: string; body: string; region: Region | "" } } | { ok: false; error: OpportunityError } {
  const headline = input.headline.trim().replace(/\s+/g, " ");
  const body = input.body.trim();
  if (!(OPPORTUNITY_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "kind" };
  if (!headline) return { ok: false, error: "headline_empty" };
  if ([...headline].length > OPP_HEADLINE_MAX) return { ok: false, error: "headline_long" };
  if ([...body].length > OPP_BODY_MAX) return { ok: false, error: "body_long" };
  if (input.region && !(REGIONS as readonly string[]).includes(input.region)) return { ok: false, error: "region" };
  return { ok: true, value: { kind: input.kind as OpportunityKind, headline, body, region: input.region as Region | "" } };
}

/** First letter for the org tile ("Banco Meridiano" → "B"). */
export function orgInitial(name: string): string {
  const m = name.trim().match(/\p{L}|\p{N}/u);
  return m ? m[0].toUpperCase() : "?";
}
