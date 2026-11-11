/**
 * Market data for the Trading agent: candles and prices for crypto, forex,
 * metals and stocks, from free public sources (no keys needed):
 * - crypto: Binance's public market-data mirror (data-api.binance.vision),
 *   which answers from anywhere; Yahoo Finance if a pair isn't listed there.
 * - forex, metals, stocks, indices: Yahoo Finance's chart data.
 */

export type Market = "crypto" | "forex" | "stock";
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Instrument = { symbol: string; market: Market; name: string; yahoo: string; binance?: string; oanda?: string; alpaca?: string };
export type Interval = "15m" | "1h" | "4h" | "1d";

const CRYPTO = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "TRX", "TON", "AVAX", "DOT", "LINK", "MATIC", "POL", "LTC", "BCH", "SHIB", "UNI", "ATOM", "XLM", "NEAR", "APT", "ARB", "OP", "SUI", "PEPE", "FIL", "ICP", "INJ", "RNDR", "RENDER", "AAVE", "ETC", "HBAR", "TAO", "WIF", "SEI", "FET"]);
const FIAT = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "DKK", "SGD", "HKD", "ZAR", "MXN", "TRY", "PLN", "CNH", "CNY", "INR", "PKR", "AED", "SAR"]);
const METALS: Record<string, { name: string; yahoo: string }> = { XAU: { name: "Gold", yahoo: "GC=F" }, XAG: { name: "Silver", yahoo: "SI=F" } };
const ALIASES: Record<string, string> = { GOLD: "XAUUSD", SILVER: "XAGUSD", BITCOIN: "BTC", ETHEREUM: "ETH", SOLANA: "SOL", RIPPLE: "XRP", DOGECOIN: "DOGE", CABLE: "GBPUSD", FIBER: "EURUSD", "S&P500": "^GSPC", SP500: "^GSPC", SPX: "^GSPC", NASDAQ: "^IXIC", NAS100: "^NDX", DOW: "^DJI", US30: "^DJI", OIL: "CL=F", WTI: "CL=F", BRENT: "BZ=F" };

/** "btc", "BTC/USDT", "eur/usd", "gold", "AAPL", "RELIANCE.NS" → one instrument. */
export function instrument(raw: string, hint?: Market): Instrument {
  let s = raw.trim().toUpperCase().replace(/\s+/g, "");
  s = ALIASES[s] ?? s;
  const pair = s.replace(/[/_-]/g, "");
  // Crypto: BTC, BTCUSDT, BTC/USD.
  const cm = /^([A-Z0-9]{2,10}?)(USDT|USDC|USD|BUSD)?$/.exec(pair);
  if (hint !== "stock" && hint !== "forex" && cm && (CRYPTO.has(cm[1]) || (hint === "crypto"))) {
    const base = cm[1];
    return { symbol: `${base}USDT`, market: "crypto", name: `${base}/USDT`, yahoo: `${base}-USD`, binance: `${base}USDT` };
  }
  // Forex and metals: EURUSD, XAUUSD.
  if (/^[A-Z]{6}$/.test(pair)) {
    const a = pair.slice(0, 3), b = pair.slice(3);
    if (METALS[a] && FIAT.has(b)) return { symbol: pair, market: "forex", name: `${METALS[a].name} (${a}/${b})`, yahoo: b === "USD" ? METALS[a].yahoo : `${pair}=X`, oanda: `${a}_${b}` };
    if (FIAT.has(a) && FIAT.has(b) && hint !== "stock") return { symbol: pair, market: "forex", name: `${a}/${b}`, yahoo: `${pair}=X`, oanda: `${a}_${b}` };
  }
  // Anything else is a stock, ETF, index or future, as Yahoo names it.
  return { symbol: s, market: "stock", name: s, yahoo: s, alpaca: /^[A-Z.]{1,6}$/.test(s) && !s.includes(".") ? s : undefined };
}

const BINANCE_INTERVAL: Record<Interval, string> = { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" };
const YAHOO: Record<Interval, { interval: string; range: string }> = {
  "15m": { interval: "15m", range: "5d" },
  "1h": { interval: "60m", range: "1mo" },
  "4h": { interval: "60m", range: "3mo" }, // grouped into 4h below
  "1d": { interval: "1d", range: "2y" },
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; assistant-market-data)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function binanceCandles(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
  const rows = await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${BINANCE_INTERVAL[interval]}&limit=${limit}`) as unknown[][];
  return rows.map(r => ({ t: Number(r[0]), o: +String(r[1]), h: +String(r[2]), l: +String(r[3]), c: +String(r[4]), v: +String(r[5]) }));
}

type YahooChart = { chart?: { result?: { meta?: { regularMarketPrice?: number; currency?: string; longName?: string; shortName?: string }; timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] } }[]; error?: { description?: string } | null } };

async function yahooCandles(symbol: string, interval: Interval): Promise<{ candles: Candle[]; name?: string; currency?: string }> {
  const { interval: iv, range } = YAHOO[interval];
  const body = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${iv}&range=${range}`) as YahooChart;
  const r = body.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error(body.chart?.error?.description || `No price data for ${symbol}.`);
  const q = r.indicators?.quote?.[0] ?? {};
  let candles: Candle[] = [];
  r.timestamp.forEach((t, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) return;
    candles.push({ t: t * 1000, o, h, l, c, v: q.volume?.[i] ?? 0 });
  });
  if (interval === "4h") candles = group(candles, 4);
  return { candles, name: r.meta?.longName || r.meta?.shortName, currency: r.meta?.currency };
}

/** Joins n consecutive candles into one (hourly into 4-hourly). */
function group(c: Candle[], n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = c.length % n; i + n <= c.length; i += n) {
    const s = c.slice(i, i + n);
    out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map(x => x.h)), l: Math.min(...s.map(x => x.l)), c: s[n - 1].c, v: s.reduce((a, x) => a + x.v, 0) });
  }
  return out;
}

const cache = new Map<string, { at: number; value: Candle[]; name?: string }>();
const FRESH: Record<Interval, number> = { "15m": 60_000, "1h": 120_000, "4h": 300_000, "1d": 900_000 };

/** Candles, oldest first, with the instrument's full name when the source gives one. */
export async function candles(inst: Instrument, interval: Interval, limit = 300): Promise<{ candles: Candle[]; name?: string }> {
  const key = `${inst.symbol}:${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH[interval]) return { candles: hit.value, name: hit.name };
  let result: { candles: Candle[]; name?: string };
  if (inst.binance) {
    try { result = { candles: await binanceCandles(inst.binance, interval, Math.min(limit, 1000)) }; }
    catch { result = await yahooCandles(inst.yahoo, interval); }
  } else result = await yahooCandles(inst.yahoo, interval);
  if (result.candles.length < 30) throw new Error(`Not enough price history for ${inst.name}.`);
  result.candles = result.candles.slice(-limit);
  cache.set(key, { at: Date.now(), value: result.candles, name: result.name });
  return result;
}

/** The latest traded price. */
export async function lastPrice(inst: Instrument): Promise<number> {
  if (inst.binance) {
    try {
      const b = await getJson(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${inst.binance}`) as { price?: string };
      if (b.price) return Number(b.price);
    } catch { /* fall through */ }
  }
  const { candles: c } = await yahooCandles(inst.yahoo, "15m");
  return c[c.length - 1].c;
}

/** Highest and lowest price since a moment, for checking whether a stop or target was touched. */
export async function rangeSince(inst: Instrument, since: number): Promise<{ high: number; low: number; last: number }> {
  const { candles: c } = await candles(inst, "15m", 500);
  const after = c.filter(x => x.t + 15 * 60_000 > since);
  const last = await lastPrice(inst).catch(() => c[c.length - 1].c);
  if (!after.length) return { high: last, low: last, last };
  return { high: Math.max(...after.map(x => x.h), last), low: Math.min(...after.map(x => x.l), last), last };
}
