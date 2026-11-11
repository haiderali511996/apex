/** Runs once when the server starts: background jobs live here. */
export async function register() {
  // Written this way so the edge build drops the import (it uses Node-only modules).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTradingScheduler } = await import("./lib/trading/scheduler");
    startTradingScheduler();
  }
}
