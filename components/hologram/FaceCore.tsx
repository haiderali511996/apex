"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS, HEAD_TURN_GLSL } from "./HologramMaterial";
import { V, heightAt } from "./geometry";
import type { HoloState } from "./state";

/**
 * Stage 4 — the amber core.
 *
 * An elliptical radial field sitting just behind the facial grid, centred
 * between the eyes and the mouth, with a bright point at its heart. Drawn
 * additively and without depth write so the cyan contours stay legible over
 * it, and it breathes gently — faster and brighter while Nova speaks.
 */
export default function FaceCore({ state }: { state: HoloState }) {
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.86, 1.02, 1, 1), []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        // No depth test: the shell is opaque, so a core sitting inside the head
        // would never be seen. It is drawn over the shell and under the
        // contours instead, which is the layering the reference shows.
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTurn: { value: new THREE.Vector2() },
          uReveal: { value: 0 },
          uBreath: { value: 0 },
          uTime: { value: 0 },
          uAmber: { value: new THREE.Color(COLORS.amber) },
          uCore: { value: new THREE.Color(COLORS.core) },
        },
        vertexShader: /* glsl */ `
          ${HEAD_TURN_GLSL}
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = applyHeadTurn(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uAmber;
          uniform vec3 uCore;
          uniform float uReveal;
          uniform float uBreath;
          uniform float uTime;
          varying vec2 vUv;

          void main() {
            // Ellipse centred in the plane, slightly taller than wide.
            vec2 d = (vUv - 0.5) * vec2(2.05, 1.72);
            float r = length(d);

            float field = exp(-pow(r * (2.5 - uBreath * 0.25), 2.0));
            float point = exp(-pow(r * 26.0, 2.0));

            float grain = fract(sin(dot(floor(vUv * 180.0), vec2(12.9898, 78.233)) + floor(uTime * 8.0)) * 43758.5453);
            float threads = pow(0.5 + 0.5 * sin(vUv.y * 420.0 + sin(vUv.x * 90.0) * 2.0), 9.0);
            vec3 col = uAmber * field * (0.38 + grain * 0.6 + threads * 0.45 + uBreath * 0.2) + uCore * point * 1.8;
            float a = clamp(field * 0.9 + point, 0.0, 1.0) * uReveal;
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
    []
  );

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(() => {
    const u = material.uniforms;
    (u.uTurn.value as THREE.Vector2).copy(state.turn);
    u.uReveal.value = state.stage(3);
    u.uTime.value = state.reduced ? 0 : state.t;
    // A slow resting breath that quickens with the voice.
    const rate = 0.9 + state.voice * 2.4;
    u.uBreath.value = state.reduced
      ? 0.5
      : (0.5 + 0.5 * Math.sin(state.t * rate)) * (0.55 + state.voice * 0.45);
  });

  // Centred between the brow and the mouth — the reference puts the field
  // across the eyes and nose, not down on the jaw.
  const y = (heightAt(V.brow) + heightAt(V.mouth)) / 2;

  return (
    <mesh geometry={geometry} material={material} position={[0, y, 0.62]} renderOrder={1} />
  );
}
