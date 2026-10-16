import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEnvelope, parseSentryDsn, parseStack, reportError } from "@/lib/error-report";
import { formatLine, log, logger, serializeError } from "@/lib/log";
import { newRequestId, requestIdFrom } from "@/lib/request-id";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("structured logger", () => {
  it("writes one JSON object per line with level, msg and context", () => {
    const line = JSON.parse(formatLine("warn", "store slow", { scope: "rate-limit", requestId: "r1", skip: undefined }, new Date("2026-10-16T00:00:00Z")));
    expect(line).toEqual({ ts: "2026-10-16T00:00:00.000Z", level: "warn", msg: "store slow", scope: "rate-limit", requestId: "r1" });
  });

  it("serializes errors (name, message, code, cause) anywhere in the context", () => {
    const err = Object.assign(new Error("boom", { cause: new TypeError("inner") }), { code: "P1001" });
    const line = JSON.parse(formatLine("error", "db down", { err }));
    expect(line.err).toMatchObject({ name: "Error", message: "boom", code: "P1001", cause: { name: "TypeError", message: "inner" } });
    expect(serializeError("plain")).toEqual({ message: "plain" });
  });

  it("never throws on circular context", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => JSON.parse(formatLine("info", "x", { loop }))).not.toThrow();
  });

  it("routes by level and honours LOG_LEVEL (error always prints)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("LOG_LEVEL", "error");
    logger.warn("hidden");
    logger.error("shown");
    expect(warn).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    vi.stubEnv("LOG_LEVEL", "debug");
    log("debug", "now visible");
    logger.child({ requestId: "abc" }).info("with id");
    expect(info).toHaveBeenCalledTimes(2);
    expect(JSON.parse(info.mock.calls[1][0] as string)).toMatchObject({ level: "info", msg: "with id", requestId: "abc" });
  });
});

describe("request ids", () => {
  it("reuses a safe upstream id and ignores unsafe ones", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "abc-123" }))).toBe("abc-123");
    expect(requestIdFrom(new Headers({ "x-railway-request-id": "rw_9" }))).toBe("rw_9");
    expect(requestIdFrom({ "x-request-id": "bad id\nwith newline" })).toBeUndefined();
    expect(requestIdFrom(new Headers())).toBeUndefined();
    expect(newRequestId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("error reporting (optional Sentry)", () => {
  it("parses DSNs, including self-hosted path prefixes, and rejects bad ones", () => {
    expect(parseSentryDsn("https://pub@o1.ingest.sentry.io/456")).toEqual({
      envelopeUrl: "https://o1.ingest.sentry.io/api/456/envelope/",
      publicKey: "pub",
      dsn: "https://pub@o1.ingest.sentry.io/456",
    });
    expect(parseSentryDsn("https://pub@sentry.example.com/base/7")?.envelopeUrl).toBe("https://sentry.example.com/base/api/7/envelope/");
    for (const bad of [undefined, "", "nope", "https://o1.ingest.sentry.io/456", "https://pub@host/not-a-number", "ftp://pub@host/1"]) expect(parseSentryDsn(bad)).toBeNull();
  });

  it("is a log line and nothing else when SENTRY_DSN is unset", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn();
    await reportError("failed", new Error("x"), { scope: "t" }, { env: {}, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(err.mock.calls[0][0] as string)).toMatchObject({ level: "error", msg: "failed", scope: "t", err: { message: "x" } });
  });

  it("sends one envelope to Sentry when SENTRY_DSN is set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    await reportError("failed", new Error("kaput"), { requestId: "r-1", orgId: "o1" }, { env: { SENTRY_DSN: "https://pub@o1.ingest.sentry.io/456", NODE_ENV: "production" }, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string; signal: AbortSignal }];
    expect(url).toBe("https://o1.ingest.sentry.io/api/456/envelope/");
    expect(init.headers["x-sentry-auth"]).toContain("sentry_key=pub");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const [header, item, event] = init.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(item).toEqual({ type: "event" });
    expect(header.event_id).toBe(event.event_id);
    expect(event).toMatchObject({ level: "error", platform: "node", environment: "production", tags: { request_id: "r-1" }, extra: { orgId: "o1", msg: "failed" } });
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "kaput" });
  });

  it("never throws when Sentry is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(reportError("failed", "string error", {}, { env: { SENTRY_DSN: "https://pub@o1.ingest.sentry.io/456" }, fetch })).resolves.toBeUndefined();
  });

  it("turns V8 stacks into oldest-first frames", () => {
    const frames = parseStack("Error: x\n    at inner (/app/src/a.ts:1:2)\n    at /app/node_modules/next/b.js:3:4");
    expect(frames).toEqual([
      { function: "<anonymous>", filename: "/app/node_modules/next/b.js", lineno: 3, colno: 4, in_app: false },
      { function: "inner", filename: "/app/src/a.ts", lineno: 1, colno: 2, in_app: true },
    ]);
    const env = buildEnvelope(parseSentryDsn("https://pub@h.io/1")!, new Error("e"), {}, {});
    expect(env.split("\n")).toHaveLength(4); // header, item header, event, trailing newline
  });
});
