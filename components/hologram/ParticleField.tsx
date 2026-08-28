"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildParticleGeometry } from "./geometry";
import { COLORS, HEAD_TURN_GLSL } from "./HologramMaterial";
import type { HoloState } from "./state";

/**
 * Stage 6 — the particle field.
 *
 * Motes clinging to the crown, jaw, shoulders and outer silhouette. Each has
 * its own seed, so drift and fade run on independent cycles: a point rises and
 * dissolves on its own schedule and the field never pulses as one. Positions
 * are computed on the GPU from that seed rather than rewritten from JavaScript
 * each frame.
 */
export default function ParticleField({ state, quality }: { state: HoloState; quality: "high" | "low" }) {
  const geometry = useMemo(
    () => buildParticleGeometry(quality === "high" ? 1500 : 520),
    [quality]
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTurn: { value: new THREE.Vector2() },
          uReveal: { value: 0 },
          uTime: { value: 0 },
          uSize: { value: 2.4 },
          uCyan: { value: new THREE.Color(COLORS.cyan) },
          uCyanHi: { value: new THREE.Color(COLORS.cyanHi) },
        },
        vertexShader: /* glsl */ `
          ${HEAD_TURN_GLSL}
          attribute float aSeed;
          uniform float uTime;
          uniform float uSize;
          varying float vFade;

          void main() {
            // Each mote runs its own slow cycle out from the body and back.
            float cycle = fract(uTime * (0.045 + aSeed * 0.07) + aSeed);
            vec3 p = applyHeadTurn(position);

            // Drift outward from the axis, and gently upward.
            vec3 out_ = normalize(vec3(p.x, 0.0, p.z) + 0.0001);
            p += out_ * cycle * (0.10 + aSeed * 0.22);
            p.y += cycle * (0.05 + aSeed * 0.16);

            // Fade in, hold, fade out.
            vFade = smoothstep(0.0, 0.18, cycle) * (1.0 - smoothstep(0.55, 1.0, cycle));

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uSize * (1.0 + aSeed) * (12.0 / -mv.z);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uCyan;
          uniform vec3 uCyanHi;
          uniform float uReveal;
          varying float vFade;

          void main() {
            // Round, soft-edged points.
            vec2 d = gl_PointCoord - 0.5;
            float r = dot(d, d);
            if (r > 0.25) discard;
            float soft = 1.0 - smoothstep(0.02, 0.25, r);

            vec3 col = mix(uCyan, uCyanHi, soft);
            gl_FragColor = vec4(col, soft * vFade * 0.85 * uReveal);
          }
        `,
      }),
    []
  );

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(() => {
    const u = material.uniforms;
    (u.uTurn.value as THREE.Vector2).copy(state.turn);
    u.uReveal.value = state.stage(5);
    u.uTime.value = state.reduced ? 0.3 : state.t;
  });

  return <points geometry={geometry} material={material} renderOrder={4} />;
}
