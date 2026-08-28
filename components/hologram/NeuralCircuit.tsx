"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildCircuitGeometry } from "./geometry";
import { COLORS, HEAD_TURN_GLSL } from "./HologramMaterial";
import type { HoloState } from "./state";

/**
 * Stage 5 — the throat circuitry.
 *
 * Amber paths branching from under the chin down the neck and across the
 * chest, grown recursively so they wander like nerves rather than reading as
 * drawn strokes. Charge travels along them at irregular intervals: two sine
 * waves at unrelated periods, so the pulse never settles into an obvious beat.
 */
export default function NeuralCircuit({ state }: { state: HoloState }) {
  const geometry = useMemo(() => buildCircuitGeometry(), []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTurn: { value: new THREE.Vector2() },
          uReveal: { value: 0 },
          uPulse: { value: 0 },
          uCharge: { value: 0 },
          uAmber: { value: new THREE.Color(COLORS.amber) },
          uCore: { value: new THREE.Color(COLORS.core) },
        },
        vertexShader: /* glsl */ `
          ${HEAD_TURN_GLSL}
          attribute float aT;
          varying float vT;
          void main() {
            vT = aT;
            vec3 p = applyHeadTurn(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uAmber;
          uniform vec3 uCore;
          uniform float uReveal;
          uniform float uPulse;
          uniform float uCharge;
          varying float vT;

          void main() {
            // Paths grow outward from the chin as the stage reveals.
            if (vT > uReveal * 1.35) discard;

            // A charge running down the branch.
            float head = exp(-pow((vT - uCharge) * 7.0, 2.0));
            float base = 0.34 + uPulse * 0.3;

            vec3 col = uAmber * base + uCore * head * 0.9;
            gl_FragColor = vec4(col, clamp(base + head, 0.0, 1.0) * min(1.0, uReveal * 1.6));
          }
        `,
      }),
    []
  );

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(() => {
    const u = material.uniforms;
    (u.uTurn.value as THREE.Vector2).copy(state.turn);
    u.uReveal.value = state.stage(4);

    if (state.reduced) {
      u.uPulse.value = 0.4;
      u.uCharge.value = -1;
      return;
    }
    // Two incommensurate periods, so the rhythm never becomes predictable.
    const a = Math.sin(state.t * 1.7);
    const b = Math.sin(state.t * 0.63 + 1.1);
    u.uPulse.value = Math.max(0, a * 0.5 + b * 0.5) * (0.5 + state.voice * 0.5);
    u.uCharge.value = ((state.t * (0.34 + state.voice * 0.5)) % 1.6) - 0.15;
  });

  return <lineSegments geometry={geometry} material={material} renderOrder={3} />;
}
