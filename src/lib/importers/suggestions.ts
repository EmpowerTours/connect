/**
 * Cold-start suggestions: what the importers produce and how repeated runs
 * merge. Pure; the server actions persist the result as ImportSuggestion rows.
 */
export const IMPORT_SOURCES = ["farcaster", "x", "wallet"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export type ReasonCode =
  /** You follow them on Farcaster (detail = their @username). */
  | "fc_follow"
  /** You follow them on X (detail = @handle). */
  | "x_follow"
  /** You both hold the same wallet starter pack (detail = pack id). */
  | "wallet_pack"
  /** A channel that matches a pack you hold (detail = pack id). */
  | "wallet_channel";

export interface SuggestionReason {
  source: ImportSource;
  code: ReasonCode;
  detail: string;
}

export interface SuggestionDraft {
  key: string;
  targetUserId?: string;
  channelId?: string;
  reason: SuggestionReason;
}

export const userKey = (id: string) => `user:${id}`;
export const channelKey = (id: string) => `channel:${id}`;

export function parseReasons(raw: string | null | undefined): SuggestionReason[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(
      (r): r is SuggestionReason =>
        !!r && typeof r === "object" && typeof (r as SuggestionReason).source === "string" && typeof (r as SuggestionReason).code === "string" && typeof (r as SuggestionReason).detail === "string",
    );
  } catch {
    // Intentional: unreadable stored reasons show as none.
    return [];
  }
}

/** Adds a reason once (same source+code+detail is not repeated). */
export function mergeReasons(existing: SuggestionReason[], add: SuggestionReason): SuggestionReason[] {
  return existing.some((r) => r.source === add.source && r.code === add.code && r.detail === add.detail) ? existing : [...existing, add];
}

/**
 * Drops what the member cannot or need not act on: themselves, people they
 * already follow, channels they already joined. Collapses duplicates.
 */
export function filterDrafts(
  drafts: SuggestionDraft[],
  ctx: { viewerId: string; following: ReadonlySet<string>; joinedChannels: ReadonlySet<string> },
): SuggestionDraft[] {
  const out = new Map<string, SuggestionDraft>();
  for (const d of drafts) {
    if (d.targetUserId && (d.targetUserId === ctx.viewerId || ctx.following.has(d.targetUserId))) continue;
    if (d.channelId && ctx.joinedChannels.has(d.channelId)) continue;
    if (!out.has(d.key)) out.set(d.key, d);
  }
  return [...out.values()];
}
