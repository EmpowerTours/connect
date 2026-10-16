/**
 * Structured logging: one JSON object per line, which Railway's log view parses and filters.
 *   { "ts": "...", "level": "error", "msg": "ingest failed", "requestId": "...", "err": { ... }, ...context }
 *
 * - LOG_LEVEL (debug | info | warn | error) sets the threshold. Default: info, or warn under
 *   tests so suites stay quiet. error always prints.
 * - Errors anywhere in the context are serialized (name, message, code, stack).
 * - Never pass secrets, tokens, cookies or full request bodies as context.
 * No dependencies and no Node-only APIs, so it is safe in any runtime.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(env: Record<string, string | undefined> = process.env): number {
  const v = (env.LOG_LEVEL ?? "").toLowerCase();
  if (v in ORDER) return ORDER[v as LogLevel];
  return env.NODE_ENV === "test" || env.VITEST ? ORDER.warn : ORDER.info;
}

export function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    const out: Record<string, unknown> = { name: e.name, message: e.message };
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") out.code = code;
    const digest = (e as { digest?: unknown }).digest;
    if (typeof digest === "string") out.digest = digest;
    if (e.stack) out.stack = e.stack.split("\n").slice(0, 12).join("\n");
    if (e.cause !== undefined) out.cause = e.cause instanceof Error ? serializeError(e.cause) : String(e.cause);
    return out;
  }
  return { message: typeof e === "string" ? e : safeString(e) };
}

function safeString(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    // Circular or exotic values: a log line must never throw.
    return String(v);
  }
}

/** Build the line (exported for tests). */
export function formatLine(level: LogLevel, msg: string, context: LogContext = {}, now: Date = new Date()): string {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v === undefined) continue;
    fields[k] = v instanceof Error ? serializeError(v) : v;
  }
  const line = { ts: now.toISOString(), level, msg, ...fields };
  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({ ts: line.ts, level, msg, context: safeString(fields) });
  }
}

export function log(level: LogLevel, msg: string, context?: LogContext): void {
  if (ORDER[level] < threshold() && level !== "error") return;
  const line = formatLine(level, msg, context);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  /** A logger that adds these fields (e.g. { requestId, scope }) to every line. */
  child(base: LogContext): Logger;
}

function make(base: LogContext): Logger {
  const at = (level: LogLevel) => (msg: string, context?: LogContext) => log(level, msg, { ...base, ...context });
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), child: (more) => make({ ...base, ...more }) };
}

export const logger: Logger = make({});
