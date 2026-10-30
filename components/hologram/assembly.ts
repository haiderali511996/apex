/** A single clock and a single registered portrait for the whole materialization. */
export const PHASE_SECONDS = 1.6;
export const ASSEMBLY_SECONDS = PHASE_SECONDS * 6;
export const PORTRAIT_FRAME = 5;
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => { const t = clamp01(n); return t * t * (3 - 2 * t); };

/** Travel up the left shoulder/cranium, over the crown, then down the right. */
export function arrivalTime(x: number, y: number) {
  const left = .18 + (1 - y) * .40;
  const right = .53 + y * .30;
  const across = smooth((x - .43) / .14);
  return left * (1 - across) + right * across;
}
