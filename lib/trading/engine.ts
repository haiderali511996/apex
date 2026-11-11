import { randomBytes } from "node:crypto";
import { database } from "@/lib/db";
import { startStep } from "@/lib/activity";
import { analyze, describeAnalysis, type Analysis } from "./analyst";
import { candles, instrument, lastPrice, rangeSince, type Instrument, type Market } from "./market";
import { px, snapshot } from "./indicators";
import { broker, BROKER_NAMES, BROKERS_FOR, type BrokerId } from "./brokers";

/**
 * The Trading agent's autopilot, per account.
 *
 * Modes: "off" (analysis on request only), "paper" (trades by itself with
 * practice money, to build an honest track record) and "live" (trades by
 * itself with real money through the connected brokers). Live is switched on
 * only on the Trading card, by the account holder, after accepting the risk —
 * never by voice, so a misheard sentence can't put money at risk. "Stop
 * trading" by voice turns everything off at once.
 *
 * Hard limits on every trade, whatever the analysis says: risk per trade (a
 * % of the account lost if the stop is hit), a daily loss limit that halts
 * new trades for the day, a maximum number of open positions, one position
 * per market, a minimum confidence and a reward of at least 1.5x the risk.
 */

export type Mode = "off" | "paper" | "live";
export type Settings = {
  mode: Mode;
  watchlist: string[];
  riskPct: number;
  dailyLossPct: number;
  maxPositions: number;
  minConfidence: number;
  intervalMin: number;
  brokers: Record<Market, BrokerId>;
  paperStart: number;
  liveAcceptedAt?: string;
  lastScanAt?: number;
};
export type Trade = {
  id: string; symbol: string; market: Market; name: string; side: "buy" | "sell"; qty: number;
  entry: number; stop: number; target: number; broker: BrokerId; mode: "paper" | "live";
  status: "open" | "closed"; openedAt: string; closedAt?: string; exit?: number; pnl?: number;
  confidence: number; reason: string; orderId?: string; closeNote?: string;
};

export const DEFAULTS: Settings = {
  mode: "off",
  watchlist: ["BTC", "ETH", "EURUSD", "XAUUSD", "SPY", "NVDA"],
  riskPct: 1, dailyLossPct: 3, maxPositions: 3, minConfidence: 60, intervalMin: 60,
  brokers: { stock: "paper", forex: "paper", crypto: "paper" },
  paperStart: 10_000,
};
const LIMITS = { riskPct: [0.1, 5], dailyLossPct: [0.5, 20], maxPositions: [1, 10], minConfidence: [50, 95], intervalMin: [15, 1440] } as const;
/** Largest position value as a multiple of the account, per market. */
const MAX_NOTIONAL: Record<Market, number> = { stock: 1, crypto: 1, forex: 10 };

function db() {
  const d = database();
  d.exec(`
    CREATE TABLE IF NOT EXISTS trading_settings (user_id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, value TEXT NOT NULL, status TEXT NOT NULL, opened_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trades_user ON trades (user_id, status, opened_at);
    CREATE TABLE IF NOT EXISTS trading_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS trading_log_user ON trading_log (user_id, id);
  `);
  return d;
}

// ── Settings ──

export function getSettings(userId: string): Settings {
  const row = db().prepare("SELECT value FROM trading_settings WHERE user_id = ?").get(userId) as { value: string } | undefined;
  const saved = row ? JSON.parse(row.value) as Partial<Settings> : {};
  return { ...DEFAULTS, ...saved, brokers: { ...DEFAULTS.brokers, ...(saved.brokers ?? {}) } };
}

function putSettings(userId: string, s: Settings) {
  db().prepare("INSERT INTO trading_settings (user_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(userId, JSON.stringify(s), new Date().toISOString());
}

/**
 * Changes settings within the limits. Going live needs `acceptLive` (the
 * card's confirmation), and at least one market with a connected broker.
 */
export function updateSettings(userId: string, patch: Partial<Settings> & { acceptLive?: boolean }): Settings {
  const s = getSettings(userId);
  const clamp = (k: keyof typeof LIMITS, v: unknown) => { const n = Number(v); const [lo, hi] = LIMITS[k]; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : s[k]; };
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) if (patch[k] !== undefined) (s as Record<string, unknown>)[k] = clamp(k, patch[k]);
  if (Array.isArray(patch.watchlist)) {
    const list = [...new Set(patch.watchlist.map(x => instrument(String(x)).symbol))].slice(0, 12);
    s.watchlist = list.map(sym => sym.endsWith("USDT") ? sym.replace(/USDT$/, "") : sym);
  }
  if (patch.brokers) for (const m of Object.keys(BROKERS_FOR) as Market[]) {
    const b = patch.brokers[m];
    if (b && BROKERS_FOR[m].includes(b)) s.brokers[m] = b;
  }
  if (patch.mode) {
    if (patch.mode === "live") {
      if (!patch.acceptLive && !s.liveAcceptedAt) throw new Error("Live trading is switched on from the Trading card, where you accept the risk. It can't be turned on by voice.");
      const real = (Object.keys(s.brokers) as Market[]).filter(m => s.brokers[m] !== "paper" && broker(s.brokers[m]));
      if (!real.length) throw new Error("No broker is connected and chosen yet. Add Alpaca or OANDA on the Connections page, choose it for a market on the Trading card, then switch to live.");
      if (patch.acceptLive) s.liveAcceptedAt = new Date().toISOString();
    }
    s.mode = patch.mode;
  }
  putSettings(userId, s);
  log(userId, `Settings: mode ${s.mode}, risk ${s.riskPct}% per trade, daily loss limit ${s.dailyLossPct}%, up to ${s.maxPositions} positions, confidence ≥ ${s.minConfidence}%, every ${s.intervalMin} min, watching ${s.watchlist.join(", ")}.`);
  return s;
}

export function activeUsers(): string[] {
  return (db().prepare("SELECT user_id, value FROM trading_settings").all() as { user_id: string; value: string }[])
    .filter(r => { try { return (JSON.parse(r.value) as Settings).mode !== "off"; } catch { return false; } })
    .map(r => r.user_id);
}

// ── Log ──

export function log(userId: string, text: string) {
  db().prepare("INSERT INTO trading_log (user_id, at, text) VALUES (?, ?, ?)").run(userId, new Date().toISOString(), text.slice(0, 1500));
  db().prepare("DELETE FROM trading_log WHERE user_id = ? AND id NOT IN (SELECT id FROM trading_log WHERE user_id = ? ORDER BY id DESC LIMIT 300)").run(userId, userId);
}

export function recentLog(userId: string, n = 20): { at: string; text: string }[] {
  return (db().prepare("SELECT at, text FROM trading_log WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, n) as { at: string; text: string }[]);
}

// ── Trades ──

function saveTrade(userId: string, t: Trade) {
  db().prepare("INSERT INTO trades (id, user_id, value, status, opened_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status")
    .run(t.id, userId, JSON.stringify(t), t.status, t.openedAt);
}

export function listTrades(userId: string, status?: "open" | "closed", limit = 100): Trade[] {
  const rows = (status
    ? db().prepare("SELECT value FROM trades WHERE user_id = ? AND status = ? ORDER BY opened_at DESC LIMIT ?").all(userId, status, limit)
    : db().prepare("SELECT value FROM trades WHERE user_id = ? ORDER BY opened_at DESC LIMIT ?").all(userId, limit)) as { value: string }[];
  return rows.map(r => JSON.parse(r.value) as Trade);
}

/** Converts one unit of the instrument's quote currency to US dollars. */
const fxCache = new Map<string, { at: number; v: number }>();
async function quoteToUsd(inst: Instrument): Promise<number> {
  if (inst.market !== "forex") return 1;
  const quote = inst.symbol.slice(3);
  if (quote === "USD") return 1;
  const hit = fxCache.get(quote);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
  const v = await lastPrice(instrument(`${quote}USD`, "forex")).catch(async () => 1 / await lastPrice(instrument(`USD${quote}`, "forex")));
  fxCache.set(quote, { at: Date.now(), v });
  return v;
}

const pnlOf = async (t: Trade, exit: number) => (t.side === "buy" ? exit - t.entry : t.entry - exit) * t.qty * await quoteToUsd(instrument(t.symbol, t.market));

/** The account's equity for a mode: the broker's for live, practice money for paper. */
async function equity(userId: string, s: Settings, market: Market): Promise<{ equity: number; via: BrokerId }> {
  const id = s.brokers[market];
  if (s.mode === "live" && id !== "paper") {
    const b = broker(id);
    if (b) return { equity: (await b.account()).equity, via: id };
  }
  const closed = listTrades(userId, "closed", 10_000).filter(t => t.mode === "paper");
  return { equity: s.paperStart + closed.reduce((a, t) => a + (t.pnl ?? 0), 0), via: "paper" };
}

/** Today's realized result (UTC day), for the daily loss limit. */
function todayPnl(userId: string, mode: "paper" | "live"): number {
  const day = new Date().toISOString().slice(0, 10);
  return listTrades(userId, "closed", 500).filter(t => t.mode === mode && t.closedAt?.startsWith(day)).reduce((a, t) => a + (t.pnl ?? 0), 0);
}

/** Opens a trade from an analysis, if every limit allows it. Returns what happened. */
export async function openFromAnalysis(userId: string, a: Analysis, s = getSettings(userId)): Promise<string> {
  const d = a.decision, inst = a.instrument;
  if (s.mode === "off") return "Autopilot is off.";
  if (d.action === "wait") return `${a.name}: no trade (wait).`;
  if (d.confidence < s.minConfidence) return `${a.name}: ${d.action} at ${d.confidence}% confidence is below your ${s.minConfidence}% minimum; no trade.`;
  const open = listTrades(userId, "open");
  if (open.some(t => t.symbol === inst.symbol)) return `${a.name}: already in a position.`;
  if (open.length >= s.maxPositions) return `${a.name}: ${open.length} positions already open (your limit is ${s.maxPositions}).`;
  const { equity: eq, via } = await equity(userId, s, inst.market);
  const mode: "paper" | "live" = via === "paper" ? "paper" : "live";
  const lost = -todayPnl(userId, mode);
  if (lost >= eq * s.dailyLossPct / 100) return `Daily loss limit reached (${lost.toFixed(2)} USD today); no new trades until tomorrow (UTC).`;

  const toUsd = await quoteToUsd(inst);
  const perUnit = Math.abs(d.entry - d.stop) * toUsd;
  let qty = (eq * s.riskPct / 100) / perUnit;
  const maxQty = (eq * MAX_NOTIONAL[inst.market]) / (d.entry * toUsd);
  if (qty > maxQty) qty = maxQty;
  const b = via === "paper" ? null : broker(via);
  qty = b ? await b.size(inst, qty) : Number(qty.toPrecision(6));
  if (!(qty > 0)) return `${a.name}: the position would be smaller than ${b?.name ?? "the minimum"} allows for ${s.riskPct}% risk; no trade.`;

  const t: Trade = {
    id: randomBytes(8).toString("hex"), symbol: inst.symbol, market: inst.market, name: a.name, side: d.action, qty,
    entry: d.entry, stop: px(d.stop), target: px(d.target), broker: via, mode, status: "open", openedAt: new Date().toISOString(),
    confidence: d.confidence, reason: d.reasons.slice(0, 3).join("; "),
  };
  if (b) {
    const placed = await b.place(inst, d.action, qty, d.stop, d.target);
    t.orderId = placed.orderId;
    if (placed.fillPrice) t.entry = px(placed.fillPrice);
  } else {
    t.entry = px(await lastPrice(inst).catch(() => d.entry));
  }
  saveTrade(userId, t);
  const line = `${mode === "live" ? "LIVE" : "Paper"} ${t.side.toUpperCase()} ${t.qty} ${t.name} at ${t.entry}, stop ${t.stop}, target ${t.target} (${s.riskPct}% risk, ${d.confidence}% confidence${b ? `, on ${b.name}` : ""}).`;
  log(userId, `Opened: ${line} Why: ${t.reason}`);
  return `Opened ${line}`;
}

/** Checks open trades: paper ones against prices, live ones with the broker. */
export async function monitor(userId: string): Promise<string[]> {
  const notes: string[] = [];
  for (const t of listTrades(userId, "open")) {
    const inst = instrument(t.symbol, t.market);
    try {
      if (t.mode === "live") {
        const b = broker(t.broker);
        if (!b || !t.orderId) continue;
        const st = await b.status(inst, t.orderId);
        if (st.open) continue;
        const exit = st.exitPrice || await lastPrice(inst);
        await finish(userId, t, exit, st.pnl, "closed at the broker");
      } else {
        const r = await rangeSince(inst, Date.parse(t.openedAt));
        const long = t.side === "buy";
        // If one stretch touched both, assume the stop came first (the cautious reading).
        const hitStop = long ? r.low <= t.stop : r.high >= t.stop;
        const hitTarget = long ? r.high >= t.target : r.low <= t.target;
        if (hitStop) await finish(userId, t, t.stop, undefined, "stop-loss hit");
        else if (hitTarget) await finish(userId, t, t.target, undefined, "target reached");
        else continue;
      }
      notes.push(`${t.name} closed`);
    } catch (err) {
      log(userId, `Couldn't check ${t.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return notes;
}

async function finish(userId: string, t: Trade, exit: number, brokerPnl: number | undefined, why: string) {
  t.status = "closed"; t.closedAt = new Date().toISOString(); t.exit = px(exit);
  t.pnl = Number((brokerPnl ?? await pnlOf(t, exit)).toFixed(2)); t.closeNote = why;
  saveTrade(userId, t);
  log(userId, `Closed ${t.mode === "live" ? "LIVE" : "paper"} ${t.side} ${t.name} at ${t.exit} (${why}): ${t.pnl >= 0 ? "+" : ""}${t.pnl} USD.`);
}

/** Closes one trade (by id or market name) or all of them, now. */
export async function closeTrades(userId: string, which: string): Promise<string> {
  const open = listTrades(userId, "open");
  const pick = which === "all" ? open : open.filter(t => t.id === which || t.symbol === instrument(which).symbol);
  if (!pick.length) return which === "all" ? "No open trades." : `No open trade for ${which}.`;
  const out: string[] = [];
  for (const t of pick) {
    const inst = instrument(t.symbol, t.market);
    try {
      if (t.mode === "live") {
        const b = broker(t.broker);
        if (!b || !t.orderId) throw new Error(`${BROKER_NAMES[t.broker]} isn't connected; close it at the broker.`);
        await b.close(inst, t.orderId);
        const st = await b.status(inst, t.orderId).catch(() => ({ open: false } as { open: boolean; exitPrice?: number; pnl?: number }));
        await finish(userId, t, st.exitPrice || await lastPrice(inst), st.pnl, "closed on request");
      } else await finish(userId, t, await lastPrice(inst), undefined, "closed on request");
      out.push(`${t.name}: closed at ${t.exit}, ${t.pnl! >= 0 ? "+" : ""}${t.pnl} USD`);
    } catch (err) { out.push(`${t.name}: couldn't close (${err instanceof Error ? err.message : err})`); }
  }
  return out.join("\n");
}

/** Quick technical screen, so the full analysis (and its AI calls) runs only where a setup may exist. */
async function worthAnalyzing(inst: Instrument): Promise<boolean> {
  const [d, h4] = await Promise.all([candles(inst, "1d", 300), candles(inst, "4h", 300)]);
  const sd = snapshot(d.candles), s4 = snapshot(h4.candles);
  return Math.abs(s4.score) >= 1 && (sd.trend !== "sideways" || Math.abs(s4.score) >= 2) && Math.sign(s4.score) === Math.sign(sd.score || s4.score);
}

const busy = new Set<string>();

/** One autopilot pass over the watchlist. */
export async function scan(userId: string, force = false): Promise<string[]> {
  const s = getSettings(userId);
  if (s.mode === "off" || busy.has(userId)) return [];
  if (!force && s.lastScanAt && Date.now() - s.lastScanAt < s.intervalMin * 60_000) return [];
  busy.add(userId);
  const end = startStep(userId, "trading_autopilot", { count: s.watchlist.length, mode: s.mode });
  const notes: string[] = [];
  try {
    putSettings(userId, { ...s, lastScanAt: Date.now() });
    const held = new Set(listTrades(userId, "open").map(t => t.symbol));
    for (const sym of s.watchlist) {
      const inst = instrument(sym);
      if (held.has(inst.symbol)) continue;
      try {
        if (!(await worthAnalyzing(inst))) continue;
        const a = await analyze(sym);
        const result = await openFromAnalysis(userId, a, s);
        notes.push(result);
        if (!/^Opened/.test(result)) log(userId, `Looked at ${a.name}: ${a.decision.action}${a.decision.action !== "wait" ? ` (${a.decision.confidence}%)` : ""}. ${result}`);
      } catch (err) {
        log(userId, `${sym}: ${err instanceof Error ? err.message : err}`);
      }
    }
    end(true, notes.filter(n => /^Opened/.test(n)).join(" ") || "No new trades this round.");
  } catch (err) {
    end(false, err instanceof Error ? err.message : String(err));
  } finally { busy.delete(userId); }
  return notes;
}

/** The honest track record, per mode. */
export function stats(userId: string, mode: "paper" | "live") {
  const closed = listTrades(userId, "closed", 10_000).filter(t => t.mode === mode);
  const wins = closed.filter(t => (t.pnl ?? 0) > 0);
  const gross = (f: (t: Trade) => boolean) => closed.filter(f).reduce((a, t) => a + Math.abs(t.pnl ?? 0), 0);
  const won = gross(t => (t.pnl ?? 0) > 0), lost = gross(t => (t.pnl ?? 0) < 0);
  let peak = 0, run = 0, drawdown = 0;
  for (const t of [...closed].reverse()) { run += t.pnl ?? 0; peak = Math.max(peak, run); drawdown = Math.max(drawdown, peak - run); }
  return {
    trades: closed.length, wins: wins.length,
    winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
    pnl: Number(closed.reduce((a, t) => a + (t.pnl ?? 0), 0).toFixed(2)),
    profitFactor: lost ? Number((won / lost).toFixed(2)) : won ? null : 0,
    maxDrawdown: Number(drawdown.toFixed(2)),
  };
}

/** Everything the Trading card and Sarah need. */
export async function status(userId: string) {
  const s = getSettings(userId);
  const open = listTrades(userId, "open");
  const withPrice = await Promise.all(open.map(async t => {
    const price = await lastPrice(instrument(t.symbol, t.market)).catch(() => t.entry);
    return { ...t, price: px(price), unrealized: Number((await pnlOf(t, price).catch(() => 0)).toFixed(2)) };
  }));
  const brokers = (["alpaca", "oanda"] as BrokerId[]).map(id => ({ id, name: BROKER_NAMES[id], connected: !!broker(id) }));
  const paperEquity = (await equity(userId, { ...s, mode: "paper" }, "stock")).equity;
  return {
    settings: s, open: withPrice, closed: listTrades(userId, "closed", 30), log: recentLog(userId, 25),
    paper: { equity: Number(paperEquity.toFixed(2)), ...stats(userId, "paper") }, live: stats(userId, "live"), brokers,
  };
}

/** Status in a few lines, for Sarah. */
export async function statusText(userId: string): Promise<string> {
  const st = await status(userId), s = st.settings;
  const lines = [
    `Autopilot: ${s.mode === "off" ? "OFF (analysis on request only)" : s.mode === "paper" ? "ON with practice money" : "ON with REAL money"}. Risk ${s.riskPct}% per trade, daily loss limit ${s.dailyLossPct}%, up to ${s.maxPositions} positions, confidence ≥ ${s.minConfidence}%, checks every ${s.intervalMin} min. Watching: ${s.watchlist.join(", ")}.`,
    `Brokers: stocks → ${BROKER_NAMES[s.brokers.stock]}, forex → ${BROKER_NAMES[s.brokers.forex]}, crypto → ${BROKER_NAMES[s.brokers.crypto]}. Connected: ${st.brokers.filter(b => b.connected).map(b => b.name).join(", ") || "none"}.`,
    `Paper record: ${st.paper.trades} trades, ${st.paper.winRate}% won, ${st.paper.pnl >= 0 ? "+" : ""}${st.paper.pnl} USD; practice balance ${st.paper.equity} USD.`,
    st.live.trades ? `Live record: ${st.live.trades} trades, ${st.live.winRate}% won, ${st.live.pnl >= 0 ? "+" : ""}${st.live.pnl} USD.` : "",
    st.open.length ? `Open: ${st.open.map(t => `${t.mode === "live" ? "LIVE " : ""}${t.side} ${t.name} from ${t.entry} (now ${t.price}, ${t.unrealized >= 0 ? "+" : ""}${t.unrealized} USD; stop ${t.stop}, target ${t.target})`).join("; ")}.` : "No open trades.",
    st.log.length ? `Latest: ${st.log.slice(0, 4).map(l => l.text).join(" | ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export { describeAnalysis };
