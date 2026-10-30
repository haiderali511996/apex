"use client";

/**
 * Verification harness for the head geometry — Stage 1 (solid, lit) beside
 * Stage 2 (cyan contour slices), with no glow, no core and no particles. If
 * the face does not read in both of these, no effect on top will save it.
 * Not linked from anywhere; it exists to be looked at. Add #angle to the URL
 * for a three-quarter view, which is where the nose has to project.
 */

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { faceZ, headSlice } from "@/components/hologram/face";

const ROWS = 230;
const SEG_FRONT = 48;
const SEG_BACK = 26;
const RING = SEG_FRONT + 1 + (SEG_BACK - 1);

function buildSurface() {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < ROWS; j++) {
    const y = j / (ROWS - 1);
    const pts = headSlice(y, SEG_FRONT, SEG_BACK);
    for (let i = 0; i < RING; i++) {
      const p = pts[i] ?? new THREE.Vector3(0, y, 0);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let j = 0; j < ROWS - 1; j++) {
    for (let i = 0; i < RING; i++) {
      const a = j * RING + i;
      const b = j * RING + ((i + 1) % RING);
      // i increases with +x and j with +y, so (a,b,c) faces outward.
      idx.push(a, b, a + RING, b, b + RING, a + RING);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function ringHeights(rings: number): number[] {
  // Space the rings by arc length along the centre-line profile of the face,
  // not by height. Equal-height spacing puts as many lines on the flat
  // forehead as on the nose; equal-arc spacing crowds them where the surface
  // is steep, which is what makes the brow, nose and lips read.
  const N = 900;
  const ys: number[] = [];
  const cum: number[] = [0];
  let prev = new THREE.Vector2(0, faceZ(0, 0));
  for (let i = 0; i <= N; i++) {
    const y = (i / N) * 0.995;
    const p = new THREE.Vector2(y, faceZ(0, y));
    ys.push(y);
    if (i > 0) cum.push(cum[cum.length - 1] + p.distanceTo(prev));
    prev = p;
  }
  const total = cum[cum.length - 1];
  const out: number[] = [];
  for (let r = 0; r < rings; r++) {
    const want = ((r + 0.5) / rings) * total;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < want) k++;
    const t = (want - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
    out.push(ys[k - 1] + (ys[k] - ys[k - 1]) * t);
  }
  return out;
}

/**
 * Contour rings sampled from the very same slices the surface is built from,
 * carrying surface normals. Without them a ring is a flat-coloured line and
 * the relief is invisible head-on — the normal is what lets the brow catch
 * light and the socket fall dark.
 */
function buildContours(rings = 40) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const eps = 0.004;
  let base = 0;

  for (const y of ringHeights(rings)) {
    const pts = headSlice(y, SEG_FRONT, SEG_BACK);
    const above = headSlice(Math.min(1, y + eps), SEG_FRONT, SEG_BACK);
    if (!pts.length || above.length !== pts.length) continue;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const along = pts[(i + 1) % pts.length].clone().sub(p);
      const up = above[i].clone().sub(p);
      const n = along.cross(up).normalize();
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      idx.push(base + i, base + ((i + 1) % pts.length));
    }
    base += pts.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

/**
 * The occluding shell. A flat fill hides the far-side rings but leaves the
 * face pitch black between the lines, so nothing reads head-on — where the
 * relief is edge-on and the rings have no vertical deviation to give it away.
 * Shading the shell dimly puts the form back under the lines.
 */
const shellMaterial = () =>
  new THREE.ShaderMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
    uniforms: { uCyan: { value: new THREE.Color("#00E5F0") }, uBg: { value: new THREE.Color("#071726") } },
    vertexShader: `
      varying vec3 vN; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uCyan; uniform vec3 uBg;
      varying vec3 vN; varying vec3 vView;
      void main() {
        float key = clamp(dot(normalize(vN), normalize(vec3(0.25, 0.55, 0.80))), 0.0, 1.0);
        float fres = 1.0 - clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
        vec3 col = uBg * 0.80 + uCyan * (pow(key, 2.6) * 0.40 + pow(fres, 3.2) * 0.26);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

const contourMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uCyan: { value: new THREE.Color("#00E5F0") }, uHi: { value: new THREE.Color("#B9FFFF") } },
    vertexShader: `
      varying float vLight;
      varying float vFres;
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec3 view = normalize(-mv.xyz);
        vLight = clamp(dot(n, normalize(vec3(0.25, 0.55, 0.80))), 0.0, 1.0);
        vFres = 1.0 - clamp(dot(n, view), 0.0, 1.0);
        // How far this point stands proud of the face plane. Head-on the
        // relief is edge-on and the key light alone leaves the middle of the
        // face black; this is what makes the nose and brow come forward.
        vDepth = clamp(position.z / 0.42, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uCyan; uniform vec3 uHi;
      varying float vLight; varying float vFres; varying float vDepth;
      void main() {
        float edge = pow(vFres, 2.2);
        // Weight depth hard and keep the floor low, so the rings are brightest
        // across the face and all but vanish around the sides of the skull —
        // otherwise the peripheral lines shout over the features.
        float d = pow(vDepth, 2.0);
        float lit = 0.06 + vLight * 0.30 + d * 1.85;
        vec3 col = mix(uCyan, uHi, clamp(d * 1.05 + edge * 0.20, 0.0, 1.0));
        gl_FragColor = vec4(col * lit, clamp(0.05 + d * 0.95 + vLight * 0.18, 0.0, 1.0));
      }
    `,
  });

export default function FaceLab() {
  const surface = useMemo(buildSurface, []);
  const contours = useMemo(() => buildContours(), []);
  const lineMat = useMemo(contourMaterial, []);
  const shellMat = useMemo(shellMaterial, []);
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    const read = () => setAngle(location.hash === "#angle" ? 0.55 : 0);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(
    () => () => { surface.dispose(); contours.dispose(); lineMat.dispose(); shellMat.dispose(); },
    [surface, contours, lineMat, shellMat]
  );

  return (
    <main style={{ width: "100vw", height: "100vh", background: "#0b1a26" }}>
      {/* Sized explicitly, as ImexHologram does. */}
      <Canvas
        camera={{ position: [0, 0, 2.5], fov: 40 }}
        gl={{ antialias: true }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[1.2, 2.2, 3]} intensity={2.1} />
        <directionalLight position={[-2.4, 0.6, 1.4]} intensity={0.55} color="#93b8ff" />

        <group position={[-0.55, -0.5, 0]} rotation={[0, angle, 0]}>
          <mesh geometry={surface}>
            <meshStandardMaterial color="#9aa4ad" roughness={0.72} metalness={0.05} />
          </mesh>
        </group>

        <group position={[0.55, -0.5, 0]} rotation={[0, angle, 0]}>
          {/* Opaque, dimly shaded shell: hides the far-side rings and carries
              the form between the near ones. */}
          <mesh geometry={surface} material={shellMat} />
          <lineSegments geometry={contours} material={lineMat} />
        </group>
      </Canvas>
    </main>
  );
}
