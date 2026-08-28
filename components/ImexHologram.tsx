"use client";

/**
 * Imex's face, as a hologram.
 *
 * Six stages assemble in sequence on mount — silhouette, contour grid, facial
 * geometry, amber core, throat circuitry, particles and rim — and then the
 * figure idles: contours scan upward, the core breathes, the circuitry pulses
 * at an irregular beat, motes drift and dissolve.
 *
 * The pointer turns the head, not the bust: the rotation is applied in the
 * vertex shaders with a weight that falls to zero by the base of the neck, so
 * the shoulders stay put and nothing tears at the join. It is clamped to four
 * degrees, which is enough to feel alive and not enough to look like a puppet.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import HumanoidMesh from "./hologram/HumanoidMesh";
import ContourLines from "./hologram/ContourLines";
import FaceCore from "./hologram/FaceCore";
import NeuralCircuit from "./hologram/NeuralCircuit";
import ParticleField from "./hologram/ParticleField";
import { COLORS } from "./hologram/HologramMaterial";
import { createHoloState, type HoloState } from "./hologram/state";
import type { VoiceState } from "@/lib/useApexVoice";

const MAX_TURN = (4 * Math.PI) / 180; // the brief's four-degree limit
const BUILD_SECONDS = 5.2;

function Scene({
  state,
  quality,
  voiceRef,
  onBuild,
}: {
  state: HoloState;
  quality: "high" | "low";
  voiceRef: React.RefObject<number>;
  onBuild: (v: number) => void;
}) {
  const target = useRef(new THREE.Vector2());
  const lastPct = useRef(-1);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Yaw follows x, pitch follows y (inverted — looking down means nodding).
      target.current.set(
        (e.clientX / window.innerWidth - 0.5) * 2 * MAX_TURN,
        -(e.clientY / window.innerHeight - 0.5) * 2 * MAX_TURN * 0.7
      );
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    state.t += dt;
    state.voice += (voiceRef.current - state.voice) * Math.min(1, dt * 5);

    if (!state.reduced && state.build < 1) {
      state.build = Math.min(1, state.build + dt / BUILD_SECONDS);
      const pct = Math.round(state.build * 100);
      if (pct !== lastPct.current) { lastPct.current = pct; onBuild(state.build); }
    }

    // Ease toward the pointer so the head settles rather than snapping.
    if (!state.reduced) state.turn.lerp(target.current, Math.min(1, dt * 3.2));
  });

  return (
    <>
      <HumanoidMesh state={state} quality={quality} />
      <FaceCore state={state} />
      <ContourLines state={state} quality={quality} />
      <NeuralCircuit state={state} />
      <ParticleField state={state} quality={quality} />
    </>
  );
}

export default function ImexHologram({
  voiceState,
  onClose,
}: {
  voiceState: VoiceState;
  onClose: () => void;
}) {
  const [reduced, setReduced] = useState(false);
  const [quality, setQuality] = useState<"high" | "low">("high");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // Fewer contours and a fifth of the particles on small or dense screens.
    const small = window.innerWidth < 820 || (window.devicePixelRatio || 1) > 2.5;
    setQuality(small ? "low" : "high");
  }, []);

  const state = useMemo(() => createHoloState(reduced), [reduced]);

  // Voice level is read every frame, so it lives in a ref rather than state.
  const voiceRef = useRef(0);
  voiceRef.current = voiceState === "speaking" ? 1 : 0;

  const label =
    progress < 1 && !reduced
      ? `ASSEMBLING....  ${Math.round(progress * 100)}%`
      : voiceState === "speaking" ? "STATUS: SPEAKING"
      : voiceState === "listening" ? "STATUS: LISTENING"
      : voiceState === "thinking" ? "STATUS: PROCESSING"
      : "STATUS: IDLE";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: COLORS.bg }}>
      <Canvas
        camera={{ position: [0, -0.12, 5.6], fov: 40 }}
        dpr={quality === "high" ? [1, 2] : [1, 1.5]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color(COLORS.bg), 1)}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <Scene state={state} quality={quality} voiceRef={voiceRef} onBuild={setProgress} />
      </Canvas>

      <button
        onClick={onClose}
        aria-label="Close face view"
        style={{
          position: "absolute", top: 20, left: "clamp(16px,3vw,40px)", zIndex: 95,
          fontFamily: "var(--font-mono)", fontSize: "0.62rem", letterSpacing: "0.2em",
          textTransform: "uppercase", cursor: "pointer", color: "rgba(240,237,232,0.7)",
          background: "rgba(4,8,15,0.5)", border: "1px solid rgba(240,237,232,0.2)",
          borderRadius: 20, padding: "7px 15px", backdropFilter: "blur(6px)",
        }}
      >
        EXIT
      </button>

      <div
        aria-live="polite"
        style={{
          position: "absolute", top: "56%", right: "clamp(18px,7vw,120px)", zIndex: 95,
          fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.22em",
          color: "rgba(0,229,240,0.75)", pointerEvents: "none", whiteSpace: "pre",
        }}
      >
        {label}
      </div>
    </div>
  );
}
