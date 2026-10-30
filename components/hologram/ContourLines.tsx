"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildContourGeometry } from "./geometry";
import { makeContourMaterial } from "./HologramMaterial";
import type { HoloState } from "./state";

/**
 * Stages 2 and 3 — the contour grid and the facial geometry.
 *
 * The two are one object: every ring is sampled from the same displaced
 * surface, so the brow, sockets, nose and mouth are carried by the lines
 * themselves rather than drawn on top of them. Rings reveal from the crown
 * downward, then a brighter band scans slowly upward forever.
 */
export default function ContourLines({ state, quality }: { state: HoloState; quality: "high" | "low" }) {
  const geometry = useMemo(
    () => (quality === "high" ? buildContourGeometry(112, 192) : buildContourGeometry(76, 112)),
    [quality]
  );
  const material = useMemo(() => makeContourMaterial(), []);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(() => {
    const u = material.uniforms;
    (u.uTurn.value as THREE.Vector2).copy(state.turn);
    // Reveal the featureless contours first, then morph them into facial relief.
    const grid = state.stage(1);
    u.uReveal.value = grid;
    u.uBuild.value = state.reduced ? 1 : grid;
    u.uFaceReveal.value = state.reduced ? 1 : state.stage(2);
    u.uScan.value = state.reduced ? 0.5 : (state.t * 0.09) % 1;
  });

  return <lineSegments geometry={geometry} material={material} renderOrder={2} />;
}
