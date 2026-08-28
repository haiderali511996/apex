"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildShellGeometry } from "./geometry";
import { makeShellMaterial } from "./HologramMaterial";
import type { HoloState } from "./state";

/**
 * Stage 1 — the silhouette. A near-black shell carrying the cyan Fresnel rim
 * (stage 6's glow). It also writes depth, which is what stops contour lines on
 * the far side of the body from showing through the front.
 */
export default function HumanoidMesh({ state, quality }: { state: HoloState; quality: "high" | "low" }) {
  const geometry = useMemo(
    () => (quality === "high" ? buildShellGeometry(128, 190) : buildShellGeometry(72, 112)),
    [quality]
  );
  const material = useMemo(() => makeShellMaterial(), []);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(() => {
    const u = material.uniforms;
    (u.uTurn.value as THREE.Vector2).copy(state.turn);
    // The silhouette is the first thing to arrive.
    u.uReveal.value = state.stage(0);
  });

  return <mesh geometry={geometry} material={material} renderOrder={0} />;
}
