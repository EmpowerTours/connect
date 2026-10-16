import type { Instrumentation } from "next";

/** Runs once when the server starts: refuse to boot a production server with a bad configuration. */
export async function register() {
  // Written as a positive check so the edge bundle drops the Node-only import entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
  }
}

/**
 * Every uncaught error in a page, layout, server action, route handler or middleware lands
 * here: a structured log line plus, with SENTRY_DSN set, a Sentry event (src/lib/error-report.ts).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { requestIdFrom } = await import("./lib/request-id");
  const ctx = {
    requestId: requestIdFrom(request.headers),
    method: request.method,
    // Path only: query strings can carry tokens.
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: "renderSource" in context ? context.renderSource : undefined,
  };
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("./lib/error-report");
    await reportError("request failed", err, ctx);
  } else {
    const { logger } = await import("./lib/log");
    logger.error("request failed", { ...ctx, err });
  }
};
