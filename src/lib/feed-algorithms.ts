/**
 * Programmable feed: ranking is a plugin, not the product.
 *
 * A FeedAlgorithm scores candidate posts; the app fetches candidates (the
 * Following or For you pool), applies the viewer's topic/channel mutes, and
 * lets the chosen algorithm order what is left. Anyone can add an algorithm
 * with registerFeedAlgorithm() — it only sees the plain FeedCandidate data
 * below, never the database — so a new feed is a single file.
 *
 * Pure and client-safe: no database, no server-only imports. Unit tested.
 */
import type { FocusTag } from "./onboarding";
import { FOCUS_TAGS } from "./onboarding";

export interface FeedCandidate {
  /** Unique per feed row (a post can appear as itself or as a repost). */
  key: string;
  postId: string;
  authorId: string;
  createdAt: Date;
  body: string;
  /** Post type chip: "", looking_for_partner, launch, hiring, insight. */
  kind: string;
  channelSlug: string | null;
  /** Shown because someone the viewer follows reposted it. */
  isRepost: boolean;
  replies: number;
  /** Distinct people replying (a 20-reply thread between two people is one conversation, not twenty). */
  repliers: number;
  likes: number;
  reposts: number;
  quotes: number;
  /** Author holds an admin-approved organization claim. */
  authorVerifiedMember: boolean;
  /** Author proved a Mera wallet with a passkey signature. */
  authorWalletVerified: boolean;
}

export interface FeedContext {
  now: Date;
  viewerId: string;
}

export interface FeedAlgorithm {
  /** Stable id stored on the user, e.g. "conversations". Lowercase, [a-z0-9_]. */
  id: string;
  /** Short name and one-line explanation, per locale. */
  label: { en: string; es: string };
  description: { en: string; es: string };
  /** Higher ranks first. Return null to leave the post out of this feed. */
  score(c: FeedCandidate, ctx: FeedContext): number | null;
}

/* ---------- topics (for mutes) ---------- */

/** Channel slug -> the focus tags it is about. */
export const CHANNEL_TOPICS: Record<string, FocusTag[]> = {
  stablecoins: ["stablecoins"],
  tokenization: ["tokenization"],
  rwa: ["rwa", "tokenization"],
  "latam-payments": ["payments", "remittances"],
  custody: ["custody"],
  "market-structure": ["market_infra"],
};

/** Plain-language cues for each focus tag. Deliberately conservative: a mute should not swallow unrelated posts. */
export const TOPIC_PATTERNS: Record<FocusTag, RegExp> = {
  stablecoins: /\b(stablecoins?|usdc|usdt|tether|pyusd|ausd|stable ?coin|establecoins?)\b/i,
  payments: /\b(payments?|pagos?|spei|pix|card rails?|merchant|acquir\w*|checkout)\b/i,
  remittances: /\b(remittances?|remesas?|cross-border transfers?)\b/i,
  custody: /\b(custody|custodian|custodia|mpc wallet|qualified custod\w*)\b/i,
  tokenization: /\b(tokeni[sz]\w*|tokenizaci[oó]n|tokenized deposits?)\b/i,
  rwa: /\b(rwa|real[- ]world assets?|activos del mundo real)\b/i,
  treasury: /\b(treasury|tesorer[ií]a|t-bills?|money market funds?)\b/i,
  market_infra: /\b(market (infra\w*|structure)|clearing|settlement|liquidaci[oó]n|exchanges?)\b/i,
  compliance: /\b(compliance|kyc|aml|travel rule|cumplimiento|regulat\w*|regulaci[oó]n|mica)\b/i,
  defi: /\b(defi|amm|lending protocol|liquidity pools?|dex)\b/i,
  wallets: /\b(wallets?|billeteras?|passkeys?|self-custody)\b/i,
  infrastructure: /\b(infrastructure|infraestructura|rpc|node operators?|validators?|l1|layer[- ]?1)\b/i,
};

export function topicsOf(c: Pick<FeedCandidate, "body" | "channelSlug">): Set<FocusTag> {
  const out = new Set<FocusTag>(c.channelSlug ? (CHANNEL_TOPICS[c.channelSlug] ?? []) : []);
  for (const tag of FOCUS_TAGS) if (TOPIC_PATTERNS[tag].test(c.body)) out.add(tag);
  return out;
}

export interface FeedMutes {
  topics: ReadonlySet<string>;
  channels: ReadonlySet<string>;
}

export function isMuted(c: FeedCandidate, mutes: FeedMutes, viewerId: string): boolean {
  if (c.authorId === viewerId) return false; // never hide your own posts from yourself
  if (c.channelSlug && mutes.channels.has(c.channelSlug)) return true;
  if (mutes.topics.size === 0) return false;
  for (const tag of topicsOf(c)) if (mutes.topics.has(tag)) return true;
  return false;
}

/* ---------- shared scoring helpers ---------- */

/** 1 for a brand-new post, ~0.35 after a day, ~0.1 after four days. */
export function recency(createdAt: Date, now: Date): number {
  const hours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
  return 1 / Math.pow(1 + hours / 24, 1.5);
}

/** Phrases that ask for engagement instead of earning it. */
export const BAIT_PATTERN =
  /\b(like (if|this if)|(rt|retweet|repost|recast|share) (if|this|to win)|follow (me|for more|back)|giveaway|airdrop alert|tag (a friend|\d+ (friends|people))|comment ["“'][^"”']+["”'] (below|to)|drop your (wallet|address))/i;

/** How lopsided the engagement is: likes and reposts per reply. */
export function baitRatio(c: Pick<FeedCandidate, "likes" | "reposts" | "replies">): number {
  return (c.likes + 2 * c.reposts) / (1 + 3 * c.replies);
}

/* ---------- built-in algorithms ---------- */

export const latest: FeedAlgorithm = {
  id: "latest",
  label: { en: "Latest", es: "Recientes" },
  description: { en: "Everything, newest first. No ranking.", es: "Todo, lo más nuevo primero. Sin ranking." },
  score: (c) => c.createdAt.getTime(),
};

export const highSignal: FeedAlgorithm = {
  id: "high_signal",
  label: { en: "High-signal", es: "Alta señal" },
  description: {
    en: "Only verified members: people whose organization claim was approved.",
    es: "Solo miembros verificados: personas con su organización aprobada.",
  },
  score(c, ctx) {
    if (!c.authorVerifiedMember && c.authorId !== ctx.viewerId) return null;
    const conversation = Math.log1p(c.repliers * 2 + c.replies);
    return recency(c.createdAt, ctx.now) * (1 + 0.25 * conversation + (c.authorWalletVerified ? 0.15 : 0));
  },
};

export const conversations: FeedAlgorithm = {
  id: "conversations",
  label: { en: "Conversations", es: "Conversaciones" },
  description: {
    en: "Posts people are actually replying to rise to the top.",
    es: "Suben las publicaciones con respuestas reales.",
  },
  score(c, ctx) {
    const talk = 3 * c.repliers + 1.5 * c.replies + 0.75 * c.quotes;
    const nod = 0.1 * c.likes; // likes alone barely move a post here
    // Conversations stay relevant longer than announcements: a softer decay.
    return Math.pow(recency(c.createdAt, ctx.now), 0.6) * (0.05 + talk + nod) * (c.isRepost ? 0.8 : 1);
  },
};

export const noBait: FeedAlgorithm = {
  id: "no_bait",
  label: { en: "No bait", es: "Sin carnada" },
  description: {
    en: "Ignores engagement bait: reposts and likes without replies count against a post.",
    es: "Ignora la carnada: reposts y likes sin respuestas restan puntos.",
  },
  score(c, ctx) {
    let s = recency(c.createdAt, ctx.now);
    const ratio = baitRatio(c);
    if (ratio > 3) s /= 1 + (ratio - 3) / 3;
    if (BAIT_PATTERN.test(c.body)) s *= 0.15;
    if (c.isRepost) s *= 0.5;
    return s;
  },
};

/* ---------- registry ---------- */

const ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const registry = new Map<string, FeedAlgorithm>();

export function registerFeedAlgorithm(alg: FeedAlgorithm): void {
  if (!ID_RE.test(alg.id)) throw new Error(`invalid feed algorithm id: ${alg.id}`);
  if (registry.has(alg.id)) throw new Error(`feed algorithm already registered: ${alg.id}`);
  for (const loc of ["en", "es"] as const) {
    if (!alg.label[loc]?.trim() || !alg.description[loc]?.trim()) throw new Error(`feed algorithm ${alg.id} needs an ${loc} label and description`);
  }
  registry.set(alg.id, alg);
}

for (const alg of [latest, highSignal, conversations, noBait]) registerFeedAlgorithm(alg);

export const DEFAULT_FEED_ALGORITHM = latest.id;

export function listFeedAlgorithms(): FeedAlgorithm[] {
  return [...registry.values()];
}

export function isFeedAlgorithmId(id: string | null | undefined): id is string {
  return !!id && registry.has(id);
}

export function getFeedAlgorithm(id: string | null | undefined): FeedAlgorithm {
  return (id && registry.get(id)) || latest;
}

/** Which algorithm a feed uses: explicit choice > the channel's default > the member's saved choice > latest. */
export function resolveFeedAlgorithm(opts: { requested?: string | null; channelDefault?: string | null; saved?: string | null }): FeedAlgorithm {
  for (const id of [opts.requested, opts.channelDefault, opts.saved]) if (isFeedAlgorithmId(id)) return registry.get(id)!;
  return latest;
}

/** Mute, score, order. Ties break newest-first so the order is stable. */
export function rankFeed(candidates: FeedCandidate[], alg: FeedAlgorithm, ctx: FeedContext, mutes: FeedMutes, take: number): FeedCandidate[] {
  const scored: { c: FeedCandidate; s: number }[] = [];
  for (const c of candidates) {
    if (isMuted(c, mutes, ctx.viewerId)) continue;
    const s = alg.score(c, ctx);
    if (s === null || !Number.isFinite(s)) continue;
    scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s || b.c.createdAt.getTime() - a.c.createdAt.getTime() || a.c.key.localeCompare(b.c.key));
  return scored.slice(0, take).map((x) => x.c);
}

/* ---------- input validation (server actions) ---------- */

export const MAX_MUTED_CHANNELS = 20;

/** Keeps only known focus tags and known channel slugs; de-duplicated, capped. */
export function sanitizeMutes(input: { topics: string[]; channels: string[] }, knownChannels: ReadonlySet<string>): { topics: string[]; channels: string[] } {
  const topics = [...new Set(input.topics)].filter((t) => (FOCUS_TAGS as readonly string[]).includes(t));
  const channels = [...new Set(input.channels)].filter((c) => knownChannels.has(c)).slice(0, MAX_MUTED_CHANNELS);
  return { topics, channels };
}
