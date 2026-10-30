import * as THREE from "three";
import { GRID } from "./faceDepth";

/**
 * The head, as measured facial geometry rather than a lathe or a sum of bumps.
 *
 * Two earlier attempts failed for the same underlying reason. A surface of
 * revolution with depth bumps can never read as a face, because a face is not
 * a body of rotation. A hand-authored height field gets closer, but the thing
 * that makes a shape recognisable is the *relative* depth of its features, and
 * those are anthropometric facts — a nose tip stands about 0.15 head-heights
 * proud of the eye socket — not something to be arrived at by taste.
 *
 * So the front of the head is a depth field baked from a real face scan (see
 * faceDepth.ts), sampled bilinearly. Everything here is the surrounding
 * scaffolding: the silhouette the face is trimmed to, the skull behind it, and
 * the slicing that the contour rings are built from.
 *
 * Units: head height (chin -> crown) is 1.0, and x is in the same units, so
 * every width below is a literal fraction of head height.
 */

/** Canonical landmarks, in head-heights above the chin. */
export const F = {
  chin: 0.0,
  chinCrease: 0.115,
  lowerLip: 0.155,
  mouth: 0.19,
  upperLip: 0.225,
  noseBase: 0.305,
  noseTip: 0.345,
  cheek: 0.40,
  eyes: 0.50,
  brow: 0.565,
  temple: 0.62,
  forehead: 0.75,
  crown: 1.0,
  /** Eye centres, either side of the bridge. */
  eyeX: 0.155,
} as const;

type Profile = [t: number, r: number][];

/**
 * Catmull-Rom through the control points. Smoothstep between knots is only
 * C1: its curvature jumps at every knot, and under a specular light that
 * showed up as a horizontal crease across the face at each one.
 */
function sample(profile: Profile, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  let i = 1;
  while (i < profile.length - 1 && x > profile[i][0]) i++;

  const p1 = profile[i - 1];
  const p2 = profile[i];
  const p0 = profile[i - 2] ?? p1;
  const p3 = profile[i + 1] ?? p2;

  const k = (x - p1[0]) / (p2[0] - p1[0]);
  const k2 = k * k;
  const k3 = k2 * k;
  return 0.5 * (
    2 * p1[1] +
    (-p0[1] + p2[1]) * k +
    (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * k2 +
    (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * k3
  );
}

/**
 * Head half-width at a height: a near-straight mandible running up from a
 * broad chin to the jaw angle, the widest point at the cheekbones, and a
 * cranium that is flatter over the top than a plain dome. A single smooth
 * curve here is precisely what reads as an egg.
 */
const HEAD_W: Profile = [
  [0.00, 0.000], [0.02, 0.098], [0.05, 0.150], [0.09, 0.186], [0.15, 0.228],
  [0.22, 0.267], [0.29, 0.300], [0.35, 0.323], [0.41, 0.343], [0.48, 0.358],
  [0.55, 0.363], [0.62, 0.358], [0.70, 0.348], [0.78, 0.331], [0.85, 0.301],
  [0.91, 0.254], [0.95, 0.199], [0.98, 0.126], [1.00, 0.000],
];

export function headHalfWidth(y: number): number {
  return sample(HEAD_W, y);
}

/** How far the skull reaches behind the face plane. */
const SKULL_D: Profile = [
  [0.00, 0.120], [0.10, 0.230], [0.22, 0.330], [0.35, 0.408], [0.50, 0.460],
  [0.62, 0.478], [0.74, 0.470], [0.84, 0.418], [0.92, 0.318], [0.97, 0.180],
  [1.00, 0.000],
];

export function skullDepth(y: number): number {
  return sample(SKULL_D, y);
}

/** The baked depth field, decoded once. */
const DEPTH = (() => {
  const bin =
    typeof atob === "function"
      ? atob(GRID.data)
      : Buffer.from(GRID.data, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / GRID.scale;
  return out;
})();

/** Bilinear sample of the baked field, clamped at the edges. */
function depthAt(x: number, y: number): number {
  const { nx, ny, x0, x1, y0, y1 } = GRID;
  const u = Math.min(nx - 1.0001, Math.max(0, ((x - x0) / (x1 - x0)) * (nx - 1)));
  const v = Math.min(ny - 1.0001, Math.max(0, ((y - y0) / (y1 - y0)) * (ny - 1)));
  const i = u | 0;
  const j = v | 0;
  const fu = u - i;
  const fv = v - j;
  const a = DEPTH[j * nx + i];
  const b = DEPTH[j * nx + i + 1];
  const c = DEPTH[(j + 1) * nx + i];
  const d = DEPTH[(j + 1) * nx + i + 1];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

/**
 * Depth of the front of the head, forward of the face plane at z = 0.
 */
export function faceZ(x: number, y: number): number {
  const hw = Math.max(1e-4, headHalfWidth(y));
  const nx = Math.min(1, Math.abs(x) / hw); // 0 centre-line -> 1 silhouette

  // Close the front onto the silhouette: flat across almost the whole face,
  // falling only in the last sliver, so the sides meet the skull without
  // flattening the features.
  const rim = 1 - Math.pow(nx, 8);

  // Draw the depth to zero at the crown and the chin, so the front surface and
  // the skull meet there instead of leaving a ridge across the top and a flat
  // cut across the bottom.
  const cap = 1 - Math.pow(Math.min(1, Math.max(0, (y - 0.965) / 0.035)), 1.4);
  const base = Math.pow(Math.min(1, Math.max(0, y / 0.05)), 0.6);

  return depthAt(x, y) * rim * cap * base;
}

/**
 * One horizontal slice through the head: across the face using the depth
 * field, then back around the skull. Returns a closed loop.
 */
export function headSlice(y: number, segFront = 46, segBack = 26): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const hw = headHalfWidth(y);
  const d = skullDepth(y);
  if (hw < 1e-3) return pts;

  // Front: left to right across the face.
  for (let i = 0; i <= segFront; i++) {
    const t = i / segFront;
    // Cluster samples toward the middle, where the features are.
    const s = Math.sin((t - 0.5) * Math.PI) * 0.5 + 0.5;
    const x = (s * 2 - 1) * hw;
    pts.push(new THREE.Vector3(x, y, faceZ(x, y)));
  }
  // Back: right to left around the skull.
  for (let i = 1; i < segBack; i++) {
    const a = (i / segBack) * Math.PI;
    const x = Math.cos(a) * hw;
    pts.push(new THREE.Vector3(x, y, -Math.sin(a) * d));
  }
  return pts;
}
