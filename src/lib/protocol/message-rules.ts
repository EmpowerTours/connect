/**
 * Body rules for Connect's signed off-chain messages (design doc section 7).
 *
 * Adapted from Farcaster hub-monorepo packages/core/src/validations.ts
 * (validateUrl, validateEmbed, validateCastAddBody, message timestamp skew).
 * Copyright (c) 2020-2025 Merkle Manufactory and others. MIT License; see
 * THIRD_PARTY_NOTICES.md. Changed for Connect: lengths are counted in code
 * points (Connect rule), at most 2 embeds, parents are {id, hash}, and the
 * envelope hashing/signing (EIP-712, P-256/secp256k1) is Connect's own and is
 * not handled here.
 *
 * Isomorphic and pure: no server imports.
 */

export const MESSAGE_TEXT_MAX = 320; // code points
export const MESSAGE_EMBEDS_MAX = 2;
export const MESSAGE_MENTIONS_MAX = 10;
export const URL_MAX_BYTES = 256;
export const CLOCK_SKEW_SECONDS = 10 * 60;
export const MESSAGE_MAX_BYTES = 2048;

export type MessageRef = { id: bigint; hash: string };
export type Embed = { url: string } | { ref: MessageRef };
export type PostAddBody = {
  text: string;
  embeds: Embed[];
  /** Connect IDs mentioned, in the same order as `mentionsPositions`. */
  mentions: bigint[];
  /** Code-point offsets into `text`, ascending. */
  mentionsPositions: number[];
  parent?: MessageRef;
  quote?: MessageRef;
  channel?: string;
};

export type RuleResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): RuleResult => ({ ok: false, error });
const OK: RuleResult = { ok: true };

/** True if the string has no lone UTF-16 surrogates, so it round-trips through UTF-8. */
export function isWellFormedUtf16(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 1..256 UTF-8 bytes, parseable, http(s) only. */
export function validateUrl(url: unknown): RuleResult {
  if (typeof url !== "string") return fail("url must be a string");
  if (!isWellFormedUtf16(url)) return fail("url must be valid utf8");
  const n = utf8Length(url);
  if (n < 1) return fail("url < 1 byte");
  if (n > URL_MAX_BYTES) return fail(`url > ${URL_MAX_BYTES} bytes`);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return fail("url is not valid");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return fail("url must be http or https");
  return OK;
}

const HASH_RE = /^0x[0-9a-f]{64}$/;

export function validateRef(ref: MessageRef | undefined): RuleResult {
  if (!ref) return fail("ref is missing");
  if (typeof ref.id !== "bigint" || ref.id <= BigInt(0)) return fail("ref id is missing");
  if (typeof ref.hash !== "string" || !HASH_RE.test(ref.hash)) return fail("ref hash is invalid");
  return OK;
}

export function validateEmbed(embed: Embed): RuleResult {
  if (embed === null || typeof embed !== "object") return fail("embed is invalid");
  const hasUrl = "url" in embed && embed.url !== undefined;
  const hasRef = "ref" in embed && embed.ref !== undefined;
  if (hasUrl && hasRef) return fail("cannot use both url and ref");
  if (hasUrl) return validateUrl((embed as { url: string }).url);
  if (hasRef) return validateRef((embed as { ref: MessageRef }).ref);
  return fail("embed must have either url or ref");
}

/** A message may be at most 10 minutes ahead of the receiver's clock. */
export function validateTimestamp(timestampSec: number, nowSec: number): RuleResult {
  if (!Number.isInteger(timestampSec) || timestampSec < 0) return fail("timestamp is invalid");
  if (timestampSec - nowSec > CLOCK_SKEW_SECONDS) return fail("timestamp more than 10 mins in the future");
  return OK;
}

export function validatePostAddBody(body: PostAddBody): RuleResult {
  const { text } = body;
  if (typeof text !== "string") return fail("text is missing");
  if (!isWellFormedUtf16(text)) return fail("text must be valid utf8");
  const chars = [...text].length;
  if (chars > MESSAGE_TEXT_MAX) return fail(`text > ${MESSAGE_TEXT_MAX} characters`);
  if (body.embeds.length > MESSAGE_EMBEDS_MAX) return fail(`embeds > ${MESSAGE_EMBEDS_MAX}`);
  if (body.mentions.length > MESSAGE_MENTIONS_MAX) return fail(`mentions > ${MESSAGE_MENTIONS_MAX}`);
  if (body.mentions.length !== body.mentionsPositions.length) return fail("mentions and mentionsPositions must match");
  if (chars === 0 && body.embeds.length === 0 && body.mentions.length === 0) return fail("post is empty");

  for (const e of body.embeds) {
    const r = validateEmbed(e);
    if (!r.ok) return r;
  }
  for (let i = 0; i < body.mentions.length; i++) {
    const m = body.mentions[i];
    if (typeof m !== "bigint" || m <= BigInt(0)) return fail("mention id is missing");
    const p = body.mentionsPositions[i];
    if (!Number.isInteger(p)) return fail("mentionsPositions must be integers");
    if (p < 0 || p > chars) return fail("mentionsPositions must be a position in text");
    if (i > 0 && p < body.mentionsPositions[i - 1]) return fail("mentionsPositions must be sorted in ascending order");
  }
  if (body.parent !== undefined) {
    const r = validateRef(body.parent);
    if (!r.ok) return r;
    if (body.channel !== undefined) return fail("cannot use both parent and channel");
  }
  if (body.quote !== undefined) {
    const r = validateRef(body.quote);
    if (!r.ok) return r;
  }
  return OK;
}
