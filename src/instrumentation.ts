/** Runs once when the server starts: refuse to boot a production server with a bad configuration. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { assertProductionEnv } = await import("./lib/env");
  assertProductionEnv();
}
