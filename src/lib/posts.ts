import { POST_MAX_LENGTH } from "./constants";

export const POST_KINDS = ["looking_for_partner", "launch", "hiring", "insight"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export function isPostKind(v: string): v is PostKind {
  return (POST_KINDS as readonly string[]).includes(v);
}

export type PostValidation = { ok: true; body: string } | { ok: false; error: "empty" | "too_long" };

/** Trims and validates a cast body (1–320 chars after trimming, counted in code points). */
export function validatePostBody(raw: string): PostValidation {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, error: "empty" };
  if ([...body].length > POST_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, body };
}

/** `@handle` mentions (not emails), lower-cased and unique, in order of appearance. */
export function extractMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|[^\w@.])@([a-z0-9_]{2,24})\b/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

export type Segment =
  | { type: "text"; value: string }
  | { type: "org"; value: string; slug: string }
  | { type: "user"; value: string; handle: string }
  | { type: "channel"; value: string; slug: string }
  | { type: "url"; value: string };

/**
 * Splits a cast into renderable segments: $org tags, @mentions, /channel refs
 * and URLs. Unknown slugs/handles stay as plain text.
 */
export function tokenizePost(body: string, known: { orgs?: Set<string>; handles?: Set<string>; channels?: Set<string> } = {}): Segment[] {
  const re = /(https?:\/\/[^\s]+)|(?<=^|[\s(])\$([a-z0-9][a-z0-9-]{1,40})|(?<=^|[\s(])@([a-z0-9_]{2,24})|(?<=^|[\s(])\/([a-z0-9][a-z0-9-]{1,30})/gi;
  const segs: Segment[] = [];
  let last = 0;
  const pushText = (v: string) => {
    if (!v) return;
    const prev = segs[segs.length - 1];
    if (prev?.type === "text") prev.value += v;
    else segs.push({ type: "text", value: v });
  };
  for (const m of body.matchAll(re)) {
    const idx = m.index ?? 0;
    pushText(body.slice(last, idx));
    const [whole, url, org, handle, channel] = m;
    if (url) {
      const clean = url.replace(/[.,!?)]+$/, "");
      segs.push({ type: "url", value: clean });
      pushText(url.slice(clean.length));
    } else if (org && (!known.orgs || known.orgs.has(org.toLowerCase()))) segs.push({ type: "org", value: whole, slug: org.toLowerCase() });
    else if (handle && (!known.handles || known.handles.has(handle.toLowerCase()))) segs.push({ type: "user", value: whole, handle: handle.toLowerCase() });
    else if (channel && (!known.channels || known.channels.has(channel.toLowerCase()))) segs.push({ type: "channel", value: whole, slug: channel.toLowerCase() });
    else pushText(whole);
    last = idx + whole.length;
  }
  pushText(body.slice(last));
  return segs;
}

/** Thread ids for a new reply: parentId is the direct parent, rootId the top of the thread. */
export function threadIdsFor(parent: { id: string; rootId: string | null } | null): { parentId: string | null; rootId: string | null } {
  if (!parent) return { parentId: null, rootId: null };
  return { parentId: parent.id, rootId: parent.rootId ?? parent.id };
}

export interface ThreadInput {
  id: string;
  parentId: string | null;
  createdAt: Date;
}
export interface ThreadNode<T extends ThreadInput> {
  post: T;
  depth: number;
  children: ThreadNode<T>[];
}

/** Builds a reply tree under `rootId`, children oldest-first. Replies whose parent is missing attach to the root. */
export function buildThread<T extends ThreadInput>(posts: T[], rootId: string): ThreadNode<T> | null {
  const root = posts.find((p) => p.id === rootId);
  if (!root) return null;
  const byParent = new Map<string, T[]>();
  const ids = new Set(posts.map((p) => p.id));
  for (const p of posts) {
    if (p.id === rootId) continue;
    const parent = p.parentId && ids.has(p.parentId) ? p.parentId : rootId;
    byParent.set(parent, [...(byParent.get(parent) ?? []), p]);
  }
  const seen = new Set<string>();
  const build = (post: T, depth: number): ThreadNode<T> => {
    seen.add(post.id);
    const kids = (byParent.get(post.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { post, depth, children: kids.map((c) => build(c, depth + 1)) };
  };
  return build(root, 0);
}

/** Depth-first flattening for rendering, with visual depth capped. */
export function flattenThread<T extends ThreadInput>(node: ThreadNode<T>, maxDepth = 3): { post: T; depth: number }[] {
  const out: { post: T; depth: number }[] = [];
  const walk = (n: ThreadNode<T>) => {
    out.push({ post: n.post, depth: Math.min(n.depth, maxDepth) });
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** Engagement-weighted "helpful" check used for reputation. */
export function isHelpful(p: { likes: number; recasts: number; replies?: number }): boolean {
  return p.likes + 2 * p.recasts + (p.replies ?? 0) >= 3;
}

/** Trending score: recent posts decay with a 48h half-life; members add a small prior. */
export function trendingScore(postDates: Date[], members: number, now: Date = new Date()): number {
  const halfLife = 48 * 3600_000;
  const activity = postDates.reduce((sum, d) => sum + Math.pow(0.5, Math.max(0, now.getTime() - d.getTime()) / halfLife), 0);
  return Math.round((activity * 10 + Math.log2(1 + members)) * 100) / 100;
}
