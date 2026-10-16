/** Runs once when the server starts: refuse to boot a production server with a bad configuration. */
export async function register() {
  // Written as a positive check so the edge bundle drops the Node-only import entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
  }
}
