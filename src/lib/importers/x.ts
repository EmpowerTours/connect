/**
 * X (Twitter) importer: the member uploads files from their own X data export
 * (Settings > Your account > Download an archive), or a CSV/text list of
 * handles. Nothing is fetched from X; no API key is involved.
 *
 * X's archive lists who you follow by numeric account id only
 * (data/following.js), not by handle. So matching works two ways:
 *   - ids  -> members who uploaded their own data/account.js (which carries
 *             their id and username) and whose username matches their
 *             profile's X link;
 *   - handles (CSV / text) -> the X link on Connect profiles.
 * Both are self-declared by the other member; the UI says so.
 */
export const MAX_X_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_X_ENTRIES = 10_000;

const HANDLE = /^[a-z0-9_]{1,15}$/;
const ID = /^\d{1,25}$/;

export interface XArchiveParse {
  /** Lowercased handles, without @. */
  handles: string[];
  accountIds: string[];
  /** From account.js: the uploader's own account. */
  self: { accountId: string; username: string } | null;
  /** Lines/entries that could not be read. */
  skipped: number;
}

/** "window.YTD.following.part0 = [...]" -> the JSON array. */
function ytdPayload(text: string): unknown | undefined {
  const m = /^\s*window\.YTD\.[A-Za-z0-9_]+\.part\d+\s*=\s*/.exec(text);
  if (!m) return undefined;
  try {
    return JSON.parse(text.slice(m[0].length).replace(/;\s*$/, ""));
  } catch {
    return undefined;
  }
}

export function normalizeHandle(raw: string): string | null {
  let v = raw.trim().replace(/^["']|["']$/g, "");
  const url = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:#!\/)?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i.exec(v);
  if (url) v = url[1];
  v = v.replace(/^@/, "").toLowerCase();
  return HANDLE.test(v) ? v : null;
}

/** The handle in a stored profile link like "https://x.com/ana". */
export function handleFromProfileLink(linkX: string): string | null {
  return linkX ? normalizeHandle(linkX) : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const HANDLE_COLUMNS = ["username", "handle", "screen_name", "screenname", "twitter", "x", "user", "account"];
const ID_COLUMNS = ["accountid", "account_id", "id", "user_id", "userid"];

function parseCsv(text: string, out: XArchiveParse) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return;
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const hCol = header.findIndex((h) => HANDLE_COLUMNS.includes(h));
  const iCol = header.findIndex((h) => ID_COLUMNS.includes(h));
  const hasHeader = hCol >= 0 || iCol >= 0;
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = splitCsvLine(line);
    const handle = normalizeHandle(cells[hasHeader ? Math.max(hCol, 0) : 0] ?? "");
    const id = iCol >= 0 ? cells[iCol] : "";
    if (handle && (hCol >= 0 || !hasHeader)) out.handles.push(handle);
    else if (id && ID.test(id)) out.accountIds.push(id);
    else out.skipped++;
  }
}

/** Parse one uploaded file: following.js, account.js, or CSV / one handle per line. */
export function parseXFile(text: string, into?: XArchiveParse): XArchiveParse {
  const out = into ?? { handles: [], accountIds: [], self: null, skipped: 0 };
  const ytd = ytdPayload(text);
  if (ytd !== undefined) {
    for (const entry of Array.isArray(ytd) ? ytd : []) {
      const e = (entry ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const f = e.following ?? e.follower;
      const a = e.account;
      if (f) {
        const id = String(f.accountId ?? "");
        const link = String(f.userLink ?? "");
        const fromLink = /[?&]screen_name=([A-Za-z0-9_]{1,15})/.exec(link)?.[1] ?? (/\/intent\/user/.test(link) ? null : normalizeHandle(link));
        if (fromLink) out.handles.push(fromLink.toLowerCase());
        if (ID.test(id)) out.accountIds.push(id);
        else if (!fromLink) out.skipped++;
      } else if (a) {
        const id = String(a.accountId ?? "");
        const username = normalizeHandle(String(a.username ?? ""));
        if (ID.test(id) && username) out.self = { accountId: id, username };
      } else out.skipped++;
    }
  } else {
    parseCsv(text, out);
  }
  out.handles = [...new Set(out.handles)].slice(0, MAX_X_ENTRIES);
  out.accountIds = [...new Set(out.accountIds)].slice(0, MAX_X_ENTRIES);
  return out;
}

export function matchXFollowing(
  parsed: Pick<XArchiveParse, "handles" | "accountIds">,
  members: { id: string; linkX: string; xAccountId: string | null }[],
): { userId: string; handle: string; by: "handle" | "id" }[] {
  const handles = new Set(parsed.handles);
  const ids = new Set(parsed.accountIds);
  const out: { userId: string; handle: string; by: "handle" | "id" }[] = [];
  for (const m of members) {
    const h = handleFromProfileLink(m.linkX);
    if (m.xAccountId && ids.has(m.xAccountId)) out.push({ userId: m.id, handle: h ?? m.xAccountId, by: "id" });
    else if (h && handles.has(h)) out.push({ userId: m.id, handle: h, by: "handle" });
  }
  return out;
}

/** account.js is only recorded when its username is the X link already on the profile. */
export function selfAccountMatchesProfile(self: XArchiveParse["self"], linkX: string): boolean {
  const h = handleFromProfileLink(linkX);
  return !!self && !!h && self.username === h;
}
