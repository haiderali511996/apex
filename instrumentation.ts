/** Runs once when the server starts: background jobs live here. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTradingScheduler } = await import("./lib/trading/scheduler");
  startTradingScheduler();
}
