import { database } from "@/lib/db";
import { runAsUser } from "@/lib/credentials";
import { activeUsers, monitor, scan, log } from "./engine";

/**
 * Runs every account's trading autopilot in the background: each minute,
 * open trades are checked (paper ones against prices, live ones with the
 * broker), and the watchlist is scanned whenever the account's interval is
 * due. Each account runs on its own keys. Started once per server process
 * (instrumentation.ts).
 */

let started = false;
let running = false;

export function startTradingScheduler() {
  if (started || process.env.TRADING_SCHEDULER === "off") return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const userId of activeUsers()) {
        const user = database().prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
        if (!user) continue;
        await runAsUser(userId, user.role === "owner", async () => {
          try {
            await monitor(userId);
            await scan(userId);
          } catch (err) { log(userId, `Autopilot error: ${err instanceof Error ? err.message : err}`); }
        });
      }
    } finally { running = false; }
  };
  setTimeout(() => void tick(), 20_000);
  setInterval(() => void tick(), 60_000);
  console.log("[trading] autopilot scheduler started");
}
