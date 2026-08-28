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
    () => (quality === "high" ? buildContourGeometry(66, 132) : buildContourGeometry(46, 80)),
    [quality]
  );
  const material = useMemo(() => makeContourMaterial(), []);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(() => {
    const u = material.uniforms;
    (u.uTurn.value as THREE.Vector2).copy(state.turn);
    // Stage 2 lays the grid in; stage 3's relief is already in the geometry,
    // so it is revealed by the same sweep rather than a second pass.
    const grid = state.stage(1);
    u.uReveal.value = grid;
    u.uBuild.value = state.reduced ? 1 : grid;
    u.uScan.value = state.reduced ? 0.5 : (state.t * 0.09) % 1;
  });

  return <lineSegments geometry={geometry} material={material} renderOrder={2} />;
}
