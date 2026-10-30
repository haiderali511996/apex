import * as THREE from "three";
import { faceZ, headHalfWidth } from "./face";

/**
 * The bust is generated procedurally rather than loaded, so there is no model
 * to ship and the face can be reshaped by editing numbers here.
 *
 * The surface is a lathe-like parametric form: for a height v it has an
 * elliptical cross-section, and the front half is then displaced to carve the
 * brow, eye sockets, nose, cheeks, mouth and chin. Every other component —
 * contour lines, the face core, the neural paths, the particle shell — samples
 * this same function, which is what keeps them registered to each other.
 *
 *   u ∈ [0, 1)  angle around the body, 0 = straight ahead
 *   v ∈ [0, 1]  height, 0 = crown, 1 = bottom of the chest
 */

/** Landmarks in v, used by the face and by the shaders' head-turn falloff. */
export const V = {
  crown: 0.0,
  brow: 0.24,
  eyes: 0.28,
  noseTip: 0.36,
  mouth: 0.445,
  chin: 0.51,
  jawBottom: 0.55,
  neckTop: 0.56,
  neckBottom: 0.72,
  shoulder: 0.85,
  bottom: 1.0,
} as const;

/** World-space Y for a given v. The bust spans roughly y ∈ [-1.5, 1.35]. */
export function heightAt(v: number): number {
  return 1.35 - v * 2.85;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The silhouette, as explicit profiles rather than formulas.
 *
 * Closed-form curves kept misbehaving at the ends — the head tapered to a
 * goblet stem and the shoulders swelled into a bell. A table says exactly what
 * the outline does at every height, and the head's last entry matches the
 * neck's first so the join is seamless.
 */
type Profile = [t: number, r: number][];

// An egg roughly 1.5x taller than wide, not a sphere.
const HEAD_RX: Profile = [
  [0.00, 0.008], [0.06, 0.23], [0.14, 0.36], [0.25, 0.425], [0.40, 0.44],
  [0.55, 0.435], [0.70, 0.41], [0.82, 0.355], [0.92, 0.265], [1.00, 0.17],
];

// Rises steeply into the shoulder line, then holds — near-vertical sides
// below it. Growing all the way down makes a cone instead of a bust.
const BODY_RX: Profile = [
  [0.00, 0.215], [0.08, 0.34], [0.18, 0.60], [0.30, 0.86], [0.42, 1.06],
  [0.55, 1.18], [0.70, 1.26], [0.85, 1.31], [1.00, 1.34],
];

function sample(profile: Profile, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < profile.length; i++) {
    if (x <= profile[i][0]) {
      const [t0, r0] = profile[i - 1];
      const [t1, r1] = profile[i];
      const k = (x - t0) / (t1 - t0);
      // Smooth the joins so the outline has no visible kinks.
      return r0 + (r1 - r0) * (k * k * (3 - 2 * k));
    }
  }
  return profile[profile.length - 1][1];
}

/** Elliptical half-widths (x) and half-depths (z) of the cross-section at v. */
function section(v: number): { rx: number; rz: number } {
  if (v <= V.jawBottom) {
    const rx = sample(HEAD_RX, v / V.jawBottom);
    // The head is deeper than it is wide, as a skull is.
    return { rx, rz: rx * 1.34 };
  }
  if (v <= V.neckBottom) {
    const t = (v - V.jawBottom) / (V.neckBottom - V.jawBottom);
    // Starts exactly at the jaw's width, so there is no step at the join.
    const rx = 0.17 + t * 0.045;
    return { rx, rz: rx * 1.2 };
  }
  const t = (v - V.neckBottom) / (V.bottom - V.neckBottom);
  const rx = sample(BODY_RX, t);
  // Depth grows far more slowly than width — shoulders are broad, not round.
  return { rx, rz: 0.28 + Math.min(1, t * 1.6) * 0.24 };
}

/**
 * Depth displacement that carves the face. Positive pushes forward.
 * `s` is the horizontal position across the face, normalised to the section
 * half-width, so features stay put as the head narrows.
 */
/** Use the existing scanned face field, fitted into the full bust. */
function faceRelief(v: number, s: number): number {
  if (v >= V.jawBottom) return 0;
  const y = 1 - v / V.jawBottom;
  const hw = headHalfWidth(y);
  return faceZ(s * hw, y) * 1.55;
}

/** Bend scan lines in the image plane so facial features read from the front.
 * Depth alone leaves perfectly horizontal lines when viewed head-on. */
function contourLift(v: number, s: number): number {
  const g = (x: number, w: number) => Math.exp(-Math.pow(x / w, 2));
  const ax = Math.abs(s);
  return (
    0.070 * g(v - V.brow, 0.040) * g(ax - 0.42, 0.24)
    - 0.064 * g(v - V.eyes, 0.032) * g(ax - 0.43, 0.23)
    + 0.075 * g(v - V.noseTip, 0.055) * g(s, 0.17)
    - 0.033 * g(v - V.mouth, 0.024) * g(s, 0.38)
    + 0.025 * g(v - (V.mouth + 0.034), 0.021) * g(s, 0.32)
  );
}

/** A point on the bust surface. */
export function bustPoint(
  u: number,
  v: number,
  target = new THREE.Vector3(),
  faceAmount = 1
): THREE.Vector3 {
  const a = u * Math.PI * 2;
  const { rx, rz } = section(v);
  const sin = Math.sin(a);
  const cos = Math.cos(a);

  // cos(a) = 1 is straight ahead (+Z).
  const front = Math.max(0, cos);
  const s = rx > 1e-4 ? (sin * rx) / rx : 0; // -1..1 across the face
  const weight = Math.pow(front, 3) * faceAmount;
  const relief = faceRelief(v, s) * weight;
  const lift = contourLift(v, s) * weight;
  return target.set(sin * rx, heightAt(v) + lift, cos * rz + relief);
}

/** Approximate surface normal, by sampling neighbours. */
export function bustNormal(
  u: number,
  v: number,
  target = new THREE.Vector3(),
  faceAmount = 1
): THREE.Vector3 {
  const e = 0.004;
  const p = bustPoint(u, v, new THREE.Vector3(), faceAmount);
  const pu = bustPoint(u + e, v, new THREE.Vector3(), faceAmount).sub(p);
  const pv = bustPoint(u, Math.min(1, v + e), new THREE.Vector3(), faceAmount).sub(p);
  return target.copy(pu.cross(pv).normalize().negate());
}

/** Solid shell, used for depth occlusion and the Fresnel rim. */
export function buildShellGeometry(segU = 128, segV = 190): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      bustPoint(u, v, p);
      bustNormal(u, v, n);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i;
      const b = a + segU + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

/**
 * Horizontal contour rings. Each ring is a closed loop that follows the
 * surface, so the face's relief bends the line rather than the line being
 * painted flat across it.
 */
export function buildContourGeometry(rings = 62, segU = 128): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const faceOffset: number[] = [];
  const faceNormal: number[] = [];
  const aV: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const featured = new THREE.Vector3();
  const n = new THREE.Vector3();
  const featuredNormal = new THREE.Vector3();
  let base = 0;

  for (let r = 0; r < rings; r++) {
    // Rings crowd slightly towards the head, where the detail is.
    const v = (r + 0.5) / rings;
    for (let i = 0; i < segU; i++) {
      const u = i / segU;
      bustPoint(u, v, p, 0);
      bustPoint(u, v, featured);
      // The true normal is what lets the shader shade brow, sockets and nose.
      // Without it the relief is invisible from straight ahead, since a pure
      // depth displacement doesn't move anything in screen space.
      bustNormal(u, v, n, 0);
      bustNormal(u, v, featuredNormal);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      faceOffset.push(featured.x - p.x, featured.y - p.y, featured.z - p.z);
      faceNormal.push(featuredNormal.x, featuredNormal.y, featuredNormal.z);
      aV.push(v);
      idx.push(base + i, base + ((i + 1) % segU));
    }
    base += segU;
  }

  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("aFaceOffset", new THREE.Float32BufferAttribute(faceOffset, 3));
  geo.setAttribute("aFaceNormal", new THREE.Float32BufferAttribute(faceNormal, 3));
  geo.setAttribute("aV", new THREE.Float32BufferAttribute(aV, 1));
  geo.setIndex(idx);
  return geo;
}

/**
 * Branching amber paths under the chin, down the throat and across the chest.
 * Grown as a small recursive tree so the branches look organic rather than
 * drawn, then projected just outside the surface.
 */
export function buildCircuitGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const aT: number[] = [];   // 0..1 along the whole path, drives the pulse
  const idx: number[] = [];
  const p = new THREE.Vector3();
  let count = 0;

  const push = (u: number, v: number, t: number) => {
    bustPoint(u, v, p);
    // Lift very slightly off the surface so the line is never z-fought.
    const lift = 1.012;
    pos.push(p.x * lift, p.y, p.z * lift + 0.004);
    aT.push(t);
    return count++;
  };

  const branch = (u: number, v: number, du: number, len: number, depth: number, t0: number) => {
    let prev = push(u, v, t0);
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const vv = v + len * k;
      // Sway, so a branch wanders instead of running straight.
      const uu = u + du * k + Math.sin(k * 5.5 + depth * 2.1) * 0.006 * depth;
      const cur = push(uu, vv, t0 + k * len * 2.2);
      idx.push(prev, cur);
      prev = cur;

      if (depth > 0 && (i === 4 || i === 7)) {
        const side = i === 4 ? 1 : -1;
        branch(uu, vv, du * 0.35 + side * 0.028, len * 0.5, depth - 1, t0 + k * len * 2.2);
      }
    }
  };

  // Two trunks from under the jaw, plus a centre line.
  branch(0.0, V.chin + 0.03, 0.0, 0.30, 2, 0);
  branch(-0.035, V.jawBottom, -0.02, 0.26, 2, 0.05);
  branch(0.035, V.jawBottom, 0.02, 0.26, 2, 0.05);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aT", new THREE.Float32BufferAttribute(aT, 1));
  geo.setIndex(idx);
  return geo;
}

/** Particles hovering just off the silhouette, densest at crown and shoulders. */
export function buildParticleGeometry(count = 1400): THREE.BufferGeometry {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    // Bias towards the crown and the shoulder line.
    const r = Math.random();
    const v = r < 0.42 ? Math.random() * 0.22 : 0.22 + Math.random() * 0.78;
    // Keep them near the silhouette edge, where they read.
    const u = (Math.random() < 0.5 ? 0.25 : 0.75) + (Math.random() - 0.5) * 0.32;

    bustPoint(u, v, p);
    bustNormal(u, v, n);
    const out = 0.02 + Math.random() * 0.30;
    pos[i * 3] = p.x + n.x * out;
    pos[i * 3 + 1] = p.y + n.y * out + (Math.random() - 0.5) * 0.1;
    pos[i * 3 + 2] = p.z + n.z * out;
    seed[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  return geo;
}
