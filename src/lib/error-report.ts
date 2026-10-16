/**
 * Error reporting: always a structured log line; additionally a Sentry event when SENTRY_DSN
 * is set. No SDK: one fetch to Sentry's envelope endpoint per error, so there is no build
 * plugin, no OpenTelemetry and no extra memory (the container budget is ~384 MB).
 * Without SENTRY_DSN this is the logger and nothing else.
 *
 * Server-side only (Node runtime). Never put secrets, cookies or request bodies in `context`.
 */
import { logger, serializeError, type LogContext } from "./log";
import { currentRequestId } from "./request-id";

export interface SentryDsn {
  /** https://<host>/api/<project>/envelope/ */
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/** https://<publicKey>@<host>[/<path>]/<projectId> */
export function parseSentryDsn(raw: string | undefined): SentryDsn | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null; // Intentional: a malformed DSN means "not configured"; the boot check warns about it.
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const project = parts.pop();
  if (!u.username || !project || !/^\d+$/.test(project)) return null;
  const prefix = parts.length ? `/${parts.join("/")}` : "";
  return { envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, publicKey: decodeURIComponent(u.username), dsn: raw.trim() };
}

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** V8 stack lines -> Sentry frames (oldest first, as Sentry expects). */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 40)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const filename = m[2];
    frames.push({ function: m[1] || "<anonymous>", filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes("node_modules") && !filename.startsWith("node:") });
  }
  return frames.reverse();
}

const hex32 = () => crypto.randomUUID().replace(/-/g, "");

/** The envelope body for one error event (exported for tests). */
export function buildEnvelope(dsn: SentryDsn, err: unknown, context: LogContext, env: Record<string, string | undefined>, now = new Date()): string {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error thrown");
  const eventId = hex32();
  const { requestId, ...extra } = context;
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: "error",
    logger: "connect",
    environment: env.SENTRY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "production",
    release: env.SENTRY_RELEASE || env.RAILWAY_GIT_COMMIT_SHA || undefined,
    server_name: env.RAILWAY_SERVICE_NAME || undefined,
    exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: parseStack(e.stack) } }] },
    tags: typeof requestId === "string" ? { request_id: requestId } : undefined,
    extra: JSON.parse(JSON.stringify(extra, (_k, v) => (v instanceof Error ? serializeError(v) : v))) as unknown,
  };
  const header = { event_id: eventId, dsn: dsn.dsn, sent_at: now.toISOString() };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface ReportOptions {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

/**
 * Log the error and, when SENTRY_DSN is set, send it to Sentry. Never throws and never
 * blocks longer than 3 s; a failed send is logged at warn and dropped.
 */
export async function reportError(msg: string, err: unknown, context: LogContext = {}, opts: ReportOptions = {}): Promise<void> {
  if (context.requestId === undefined) {
    const requestId = await currentRequestId();
    if (requestId) context = { requestId, ...context };
  }
  logger.error(msg, { ...context, err });
  const env = opts.env ?? process.env;
  const dsn = parseSentryDsn(env.SENTRY_DSN);
  if (!dsn) return;
  const send = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  try {
    const body = buildEnvelope(dsn, err, { ...context, msg }, env);
    const res = await send(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=connect-report/1.0`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) logger.warn("error report rejected", { status: res.status });
  } catch (e) {
    logger.warn("error report not sent", { err: e instanceof Error ? e.name : "unknown" });
  }
}
