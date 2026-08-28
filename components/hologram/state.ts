import * as THREE from "three";

/**
 * One mutable object shared by every part of the hologram, so the components
 * read the same clock, the same pointer turn and the same build progress
 * without React re-rendering the scene sixty times a second.
 */
export type HoloState = {
  /** Seconds since the scene mounted. */
  t: number;
  /** Yaw and pitch in radians, already clamped to the 4° limit. */
  turn: THREE.Vector2;
  /** 0..1 over the whole six-stage build. */
  build: number;
  /** 0 quiet … 1 speaking, eased. Drives the core and the circuitry. */
  voice: number;
  /** True when the visitor asked for reduced motion. */
  reduced: boolean;
  /** How far stage `i` (0-5) has revealed, 0..1. */
  stage: (i: number) => number;
};

/** Each stage starts a little before the previous one has finished. */
const STAGE_START = [0, 0.1, 0.28, 0.46, 0.62, 0.76];
const STAGE_LEN = 0.24;

export function createHoloState(reduced: boolean): HoloState {
  const s: HoloState = {
    t: 0,
    turn: new THREE.Vector2(),
    build: reduced ? 1 : 0,
    voice: 0,
    reduced,
    stage: (i: number) => {
      const start = STAGE_START[i] ?? 0;
      return Math.min(1, Math.max(0, (s.build - start) / STAGE_LEN));
    },
  };
  return s;
}
