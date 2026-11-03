import { smooth } from "./assembly";

/**
 * Where Sarah's head is turned, in radians. The presence view writes it every
 * frame; the portrait, mouth and energy layers all read it, so they turn as
 * one head. Positive yaw looks toward screen right, positive pitch looks down.
 */
export const headPose = { yaw: 0, pitch: 0 };

/** The head is treated as a rounded shape centred on the face: crown to chin vertically. */
export const HEAD_CX = 0.5;
export const HEAD_RADIUS = 0.2;
export const HEAD_CY = 0.33;
export const HEAD_RY = 0.32;
/** How far the whole head rises or drops at a full nod, as a share of the height. */
const NOD_TRAVEL = 0.06;
/** Where the chin sits and where the neck meets the shoulders. */
const CHIN = 0.62, NECK_BASE = 0.84;

/** Share of the turn a row takes: the whole head, fading down the neck, none on the shoulders. */
export function turnWeight(y: number) {
  return 1 - smooth((y - 0.6) / 0.18);
}

/** For a screen column x (0..1) on a row turned by `yaw`, the column of the artwork to show there. */
export function sourceX(x: number, yaw: number) {
  const u = (x - HEAD_CX) / HEAD_RADIUS;
  if (Math.abs(u) >= 1 || !yaw) return x;
  // Rotate the cylinder's surface, tapering to nothing at its silhouette so
  // the head's outline stays put while the features slide around it.
  const turned = Math.sin(Math.asin(u) - yaw);
  const taper = 1 - u ** 6;
  return HEAD_CX + HEAD_RADIUS * (u + (turned - u) * taper);
}

/**
 * Where a feature on the head's centre line ends up across the screen, and how
 * foreshortened it is. `depth` < 1 is for things inside the head, which swing
 * less than the surface.
 */
export function centreLine(yaw: number, depth = 1) {
  return { x: HEAD_CX + HEAD_RADIUS * depth * Math.sin(yaw), squash: Math.cos(yaw) };
}

/** How much of a nod a column takes: full down the middle of the face, less toward the sides, like a ball. */
function noddingWeight(x: number) {
  const u = (x - HEAD_CX) / HEAD_RADIUS;
  return Math.sqrt(Math.max(0, 1 - u * u));
}

/** For a screen row y at column x (both 0..1) with the head nodded by `pitch`, the row of the artwork to show. */
export function sourceY(x: number, y: number, pitch: number) {
  const v = (y - HEAD_CY) / HEAD_RY;
  const p = pitch * noddingWeight(x);
  if (Math.abs(v) >= 1 || !p) return y;
  const turned = Math.sin(Math.asin(v) - p);
  // The crown fades out sooner than the chin, so the skull's dome stays round.
  const taper = v < 0 ? 1 - (-v) ** 2.5 : 1 - v ** 6;
  return HEAD_CY + HEAD_RY * (v + (turned - v) * taper);
}

/** How far the whole head moves with a nod: down when looking down, up when looking up. */
function nodTravel(pitch: number) {
  return Math.sin(pitch) * NOD_TRAVEL;
}

/**
 * Share of that travel a point takes: all of the head, fading down the neck so
 * it stretches or compresses, and fading toward the sides low down so the
 * shoulders stay put.
 */
function travelWeight(x: number, y: number) {
  if (y <= CHIN) return 1;
  const u = Math.abs(x - HEAD_CX) / HEAD_RADIUS;
  return (1 - smooth((y - CHIN) / (NECK_BASE - CHIN))) * (1 - smooth((u - 0.6) / 0.4));
}

/** The full nod for one screen point: move the head, then rotate its surface inside the outline. */
function nodSource(x: number, y: number, pitch: number) {
  return sourceY(x, y - nodTravel(pitch) * travelWeight(x, y), pitch);
}

/**
 * Where a feature at row y on the face's centre line ends up after a nod.
 * `depth` < 1 is for things inside the head, whose surface rotation is smaller;
 * the whole-head travel applies to everything in it.
 */
export function noddedY(y: number, pitch: number, depth = 1) {
  const v = Math.max(-1, Math.min(1, (y - HEAD_CY) / HEAD_RY));
  const a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.asin(v) + pitch * depth));
  return HEAD_CY + HEAD_RY * (v + (Math.sin(a) - v) * depth) + nodTravel(pitch);
}

// The warped portrait is cached and redrawn only when the pose moves enough to
// see. A rebuild is thousands of draws plus a pixel readback, so redrawing on
// every hair of the idle sway starved the page — speech and the mic stalled.
const REWARP = 0.003;
let cache: { canvas: HTMLCanvasElement; texture: HTMLCanvasElement; yaw: number; pitch: number } | null = null;
// Scratch canvas for the first (nodding) pass.
let nodded: HTMLCanvasElement | null = null;
// The unturned head's brightness per gap cell, read once per texture.
let original: { texture: HTMLCanvasElement; data: Uint8ClampedArray } | null = null;
// One pixel per gap cell, so the one readback per texture is tiny.
let cells: CanvasRenderingContext2D | null = null;
const MOTE_COLORS = ["56,216,250", "192,247,255", "120,230,255"];

/**
 * Draws the portrait with only the head turned: the head band warps as one,
 * the neck blends over many thin bands, the shoulders stay untouched.
 */
export function drawTurnedPortrait(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement, width: number, height: number) {
  const { yaw, pitch } = headPose;
  if (Math.abs(yaw) < 0.002 && Math.abs(pitch) < 0.002) {
    ctx.drawImage(texture, 0, 0, width, height);
    return;
  }
  if (!cache || cache.texture !== texture || Math.abs(cache.yaw - yaw) > REWARP || Math.abs(cache.pitch - pitch) > REWARP) {
    const canvas = cache?.texture === texture ? cache.canvas : document.createElement("canvas");
    canvas.width = texture.width; canvas.height = texture.height;
    warp(canvas.getContext("2d")!, texture, yaw, pitch);
    cache = { canvas, texture, yaw, pitch };
  }
  ctx.drawImage(cache.canvas, 0, 0, width, height);
}

/** First pass: nod the head inside its outline, column group by column group. */
function nod(texture: HTMLCanvasElement, pitch: number) {
  const tw = texture.width, th = texture.height;
  nodded ??= document.createElement("canvas");
  if (nodded.width !== tw || nodded.height !== th) { nodded.width = tw; nodded.height = th; }
  const ctx = nodded.getContext("2d")!;
  ctx.clearRect(0, 0, tw, th);
  ctx.drawImage(texture, 0, 0);
  if (Math.abs(pitch) < 0.002) return nodded;
  // From the top of the frame down to where the neck meets the shoulders.
  const columns = 32, rows = 84;
  const left = HEAD_CX - HEAD_RADIUS, span = HEAD_RADIUS * 2, height = NECK_BASE;
  ctx.clearRect(left * tw, 0, span * tw, height * th);
  for (let c = 0; c < columns; c++) {
    const x0 = left + (c / columns) * span, x1 = left + ((c + 1) / columns) * span, mid = (x0 + x1) / 2;
    for (let r = 0; r < rows; r++) {
      const y0 = (r / rows) * height, y1 = ((r + 1) / rows) * height;
      // Above the frame (the head has dropped) there is only background.
      const s0 = Math.max(0, nodSource(mid, y0, pitch)), s1 = Math.min(1, nodSource(mid, y1, pitch));
      if (s1 <= s0) continue;
      ctx.drawImage(texture, x0 * tw, s0 * th, (x1 - x0) * tw, Math.max(0.5, (s1 - s0) * th), x0 * tw, y0 * th, (x1 - x0) * tw + 0.6, (y1 - y0) * th + 0.6);
    }
  }
  return nodded;
}

/** Second pass: turn the nodded head left or right, blending down the neck. */
function warp(ctx: CanvasRenderingContext2D, original: HTMLCanvasElement, yaw: number, pitch: number) {
  const texture = nod(original, pitch);
  const tw = texture.width, th = texture.height;
  ctx.clearRect(0, 0, tw, th);
  const left = HEAD_CX - HEAD_RADIUS, span = HEAD_RADIUS * 2;
  // Bands of rows sharing one turn weight: the head, the neck in thin steps, the shoulders.
  const bands: [number, number][] = [[0, 0.6]];
  for (let y = 0.6; y < 0.78 - 1e-6; y += 0.004) bands.push([y, y + 0.004]);
  bands.push([0.78, 1]);
  for (const [top, bottom] of bands) {
    const w = turnWeight((top + bottom) / 2);
    const columns = top === 0 ? 96 : 40;
    const srcTop = top * th, srcH = (bottom - top) * th, destTop = top * th, destH = srcH + 0.5;
    // Outside the head's columns the row is only shifted, never warped.
    ctx.drawImage(texture, 0, srcTop, left * tw, srcH, 0, destTop, left * tw + 0.5, destH);
    ctx.drawImage(texture, (left + span) * tw, srcTop, (1 - left - span) * tw, srcH, (left + span) * tw - 0.5, destTop, (1 - left - span) * tw + 0.5, destH);
    for (let c = 0; c < columns; c++) {
      const x0 = left + (c / columns) * span, x1 = left + ((c + 1) / columns) * span;
      const s0 = sourceX(x0, yaw * w), s1 = sourceX(x1, yaw * w);
      ctx.drawImage(texture, s0 * tw, srcTop, Math.max(0.5, (s1 - s0) * tw), srcH, x0 * tw, destTop, (x1 - x0) * tw + 0.6, destH);
    }
  }
  fillGaps(ctx, original, yaw, pitch);
}

/** Stable pseudo-random value per position, so motes don't flicker as the head moves. */
function hash(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Turning stretches dark background into the head's outline on the side that
 * moves away. Wherever the head used to be lit and now isn't, fill it with
 * hologram motes, denser where the gap is darker.
 */
function fillGaps(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement, yaw: number, pitch: number) {
  const tw = texture.width, th = texture.height;
  const x0 = Math.floor((HEAD_CX - HEAD_RADIUS) * tw), x1 = Math.ceil((HEAD_CX + HEAD_RADIUS) * tw);
  const yEnd = Math.floor(0.78 * th);
  // Compare small areas, not pixels: the contour lines shifting sideways
  // must not count as gaps, only regions that went dark. Scaling the head
  // down averages each cell into one pixel; it is read once per texture.
  const cell = 6;
  const cols = Math.ceil((x1 - x0) / cell), rows = Math.ceil(th / cell);
  if (original?.texture !== texture) {
    cells ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    cells.canvas.width = cols; cells.canvas.height = rows;
    cells.drawImage(texture, x0, 0, cols * cell, rows * cell, 0, 0, cols, rows);
    original = { texture, data: cells.getImageData(0, 0, cols, rows).data };
  }
  const before = original.data;
  const brightness = (px: number, py: number) => {
    const col = Math.floor((px - x0) / cell), row = Math.floor(py / cell);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return 0;
    const i = (row * cols + col) * 4;
    return Math.max(before[i], before[i + 1], before[i + 2]);
  };
  // The turn only moves pixels, so what a cell shows now is the artwork at
  // the spot the two passes copied it from. Reading the warped canvas back
  // instead forced a GPU sync on every rebuild and stalled the page.
  const shownFrom = (cx: number, cy: number) => {
    const x = (cx + cell / 2) / tw, y = (cy + cell / 2) / th;
    const sx = sourceX(x, yaw * turnWeight(y));
    const sy = y < NECK_BASE ? nodSource(sx, y, pitch) : y;
    // Pulled down from above the frame: only background shows there.
    if (sy < 0 || sy > 1) return 0;
    return brightness(sx * tw, sy * th);
  };
  const paths = MOTE_COLORS.map(() => [new Path2D(), new Path2D(), new Path2D()]);
  for (let cy = 0; cy < yEnd; cy += cell) {
    for (let cx = x0; cx < x1; cx += cell) {
      // A gap is inside the head's original outline but now as dark as the
      // background; darker features that merely moved (eyes, grooves) are not.
      const was = brightness(cx + cell / 2, cy + cell / 2);
      if (was < 45) continue;
      const now = shownFrom(cx, cy);
      if (now > 34) continue;
      const gap = Math.min(1, 0.45 + 0.55 * (was - now) / was);
      // A few motes per cell, more where the gap is deeper.
      const count = Math.round(gap * 5);
      for (let k = 0; k < count; k++) {
        const r = hash(cx + k * 31, cy);
        const x = cx + hash(cy, cx + k * 17) * cell, y = cy + hash(cx + k * 7, cy + 3) * cell;
        const size = 0.6 + r * 1.1;
        paths[Math.floor(hash(cx + k, cy + 1) * MOTE_COLORS.length)][Math.min(2, Math.floor(gap * 3))].rect(x, y, size, size);
      }
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  paths.forEach((levels, c) => levels.forEach((path, level) => {
    ctx.fillStyle = `rgba(${MOTE_COLORS[c]},${0.45 + level * 0.22})`;
    ctx.fill(path);
  }));
  ctx.restore();
}
