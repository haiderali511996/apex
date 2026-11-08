import type { Candle } from "./market";

/**
 * Technical analysis, computed exactly (no AI): trend, momentum, volatility
 * and key levels on one timeframe, plus a plain setup score the analyst uses
 * to decide whether a market is worth a closer look at all.
 */

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1), out: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / Math.min(period, values.length);
  values.forEach((v, i) => { prev = i < period ? prev : v * k + prev * (1 - k); out.push(prev); });
  return out;
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export function atr(c: Candle[], period = 14): number {
  const tr = c.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - c[i].c), Math.abs(x.l - c[i].c)));
  if (!tr.length) return 0;
  let a = tr.slice(0, period).reduce((s, v) => s + v, 0) / Math.min(period, tr.length);
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

export function macd(closes: number[]) {
  const fast = ema(closes, 12), slow = ema(closes, 26);
  const line = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(line, 9);
  const n = closes.length - 1;
  return { line: line[n], signal: signal[n], hist: line[n] - signal[n], prevHist: line[n - 1] - signal[n - 1] };
}

/** Recent swing highs and lows: where price turned, the likely support and resistance. */
export function levels(c: Candle[], lookback = 120, span = 3) {
  const s = c.slice(-lookback), highs: number[] = [], lows: number[] = [];
  for (let i = span; i < s.length - span; i++) {
    const win = s.slice(i - span, i + span + 1);
    if (s[i].h === Math.max(...win.map(x => x.h))) highs.push(s[i].h);
    if (s[i].l === Math.min(...win.map(x => x.l))) lows.push(s[i].l);
  }
  const price = c[c.length - 1].c;
  return {
    resistance: highs.filter(h => h > price).sort((a, b) => a - b).slice(0, 3),
    support: lows.filter(l => l < price).sort((a, b) => b - a).slice(0, 3),
  };
}

export type Snapshot = {
  price: number; change: number;
  ema20: number; ema50: number; ema200: number;
  trend: "up" | "down" | "sideways";
  rsi: number; macdHist: number; macdTurn: "up" | "down" | "none";
  atr: number; atrPct: number;
  bbUpper: number; bbLower: number;
  support: number[]; resistance: number[];
  volumeRatio: number;
  /** -3 (strong sell setup) … +3 (strong buy setup). */
  score: number;
};

export function snapshot(c: Candle[]): Snapshot {
  const closes = c.map(x => x.c), n = closes.length - 1, price = closes[n];
  const e20 = ema(closes, 20)[n], e50 = ema(closes, 50)[n], e200 = ema(closes, Math.min(200, n))[n];
  const r = rsi(closes), m = macd(closes), a = atr(c);
  const last20 = closes.slice(-20), mean = last20.reduce((s, v) => s + v, 0) / last20.length;
  const sd = Math.sqrt(last20.reduce((s, v) => s + (v - mean) ** 2, 0) / last20.length);
  const vols = c.slice(-21, -1).map(x => x.v), avgVol = vols.reduce((s, v) => s + v, 0) / Math.max(1, vols.length);
  const trend = price > e50 && e20 > e50 && e50 >= e200 * 0.995 ? "up" : price < e50 && e20 < e50 && e50 <= e200 * 1.005 ? "down" : "sideways";
  const macdTurn = m.hist > 0 && m.prevHist <= 0 ? "up" : m.hist < 0 && m.prevHist >= 0 ? "down" : "none";
  let score = 0;
  score += trend === "up" ? 1 : trend === "down" ? -1 : 0;
  score += m.hist > 0 ? 0.5 : -0.5;
  score += macdTurn === "up" ? 0.5 : macdTurn === "down" ? -0.5 : 0;
  score += r > 55 && r < 70 ? 0.5 : r < 45 && r > 30 ? -0.5 : 0;
  // Stretched: a pullback is likelier than a continuation.
  if (r >= 75) score -= 1; if (r <= 25) score += 1;
  score += price > e200 ? 0.5 : -0.5;
  const lv = levels(c);
  return {
    price, change: closes[n - 1] ? (price - closes[n - 1]) / closes[n - 1] : 0,
    ema20: e20, ema50: e50, ema200: e200, trend,
    rsi: r, macdHist: m.hist, macdTurn,
    atr: a, atrPct: a / price,
    bbUpper: mean + 2 * sd, bbLower: mean - 2 * sd,
    support: lv.support, resistance: lv.resistance,
    volumeRatio: avgVol ? c[n].v / avgVol : 1,
    score: Math.max(-3, Math.min(3, score)),
  };
}

/** Rounds a price sensibly for its size. */
export function px(v: number): number {
  const d = v >= 1000 ? 2 : v >= 10 ? 3 : v >= 1 ? 4 : v >= 0.01 ? 6 : 8;
  return Number(v.toFixed(d));
}
