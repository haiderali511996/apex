"use client";

/**
 * Sarah's core: a particle sphere inside an instrument ring, drawn on a 2D
 * canvas. Everything reacts to the voice state — the sphere breathes at rest,
 * a sweep runs while listening, the rings spin up while thinking, and the
 * surface swells with each syllable while Sarah speaks.
 *
 * State is read through refs, so React re-renders never restart the loop.
 */

import { useEffect, useRef } from "react";
import { readSpeechMotion } from "@/lib/speechMotion";
import type { VoiceState } from "@/lib/useApexVoice";

const CYAN: [number, number, number] = [0, 229, 255];
const AMBER: [number, number, number] = [245, 166, 35];
const POINTS = 1100;

const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;

/** Evenly spread points on a unit sphere (Fibonacci lattice). */
function lattice(n: number) {
  const pts: { x: number; y: number; z: number; seed: number }[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    pts.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r, seed: Math.random() * Math.PI * 2 });
  }
  return pts;
}

export default function SarahCore({ state, onActivate, label }: {
  state: VoiceState;
  onActivate: () => void;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const pts = lattice(POINTS);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let size = 0, dpr = 1, frame = 0;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = Math.min(canvas.clientWidth, canvas.clientHeight);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    resize();
    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(0); });
    ro.observe(canvas);

    // Smoothed values, so a state change eases in instead of snapping.
    let energy = 0.2, spin = 0.12, sweep = 0, swell = 0;
    let angle = 0, ringAngle = 0, last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const speech = readSpeechMotion();
      const target = s === "speaking" ? 0.85 : s === "thinking" ? 0.7 : s === "listening" ? 0.5 : 0.2;
      energy += (target - energy) * Math.min(1, dt * 3);
      spin += ((s === "thinking" ? 0.9 : s === "speaking" ? 0.35 : 0.12) - spin) * Math.min(1, dt * 2);
      sweep += ((s === "listening" ? 1 : 0) - sweep) * Math.min(1, dt * 4);
      swell += ((speech.active ? speech.open : 0) - swell) * Math.min(1, dt * 18);
      angle += spin * dt;
      ringAngle += (0.05 + spin * 0.25) * dt;

      const w = canvas.width, h = canvas.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
      const R = size * 0.3 * (1 + 0.025 * Math.sin(now / 900) + swell * 0.08);
      const ringR = size * 0.43;
      const accent = s === "listening" ? AMBER : CYAN;

      // Light cast behind the sphere.
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, ringR * 1.15);
      glow.addColorStop(0, rgba(CYAN, 0.16 + energy * 0.14 + swell * 0.1));
      glow.addColorStop(0.55, rgba(CYAN, 0.04 + energy * 0.04));
      glow.addColorStop(1, rgba(CYAN, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      // Outer instrument ring: ticks, every sixth one long.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringAngle);
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const long = i % 6 === 0;
        const r0 = ringR - (long ? 10 : 5);
        ctx.strokeStyle = rgba(AMBER, long ? 0.55 : 0.22);
        ctx.lineWidth = long ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * ringR, Math.sin(a) * ringR);
        ctx.stroke();
      }
      ctx.restore();

      // Main ring, brighter with energy.
      ctx.strokeStyle = rgba(AMBER, 0.35 + energy * 0.45);
      ctx.lineWidth = 1.6;
      ctx.shadowColor = rgba(AMBER, 0.8);
      ctx.shadowBlur = 8 + energy * 18;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Counter-rotating arc segments.
      const arcs: [number, number, number, number][] = [
        [ringR + 18, 0.0, 0.9, 1], [ringR + 18, 2.4, 0.5, 1], [ringR - 22, 1.1, 1.3, -1.6], [ringR - 22, 4.0, 0.7, -1.6],
      ];
      for (const [r, start, len, dir] of arcs) {
        const a = start + ringAngle * dir * 2.2;
        ctx.strokeStyle = rgba(dir > 0 ? CYAN : AMBER, 0.25 + energy * 0.35);
        ctx.lineWidth = dir > 0 ? 2 : 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a, a + len);
        ctx.stroke();
      }

      // Inner dashed orbit.
      ctx.setLineDash([2, 7]);
      ctx.strokeStyle = rgba(CYAN, 0.18 + energy * 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Listening sweep: a radar wedge trailing a bright edge.
      if (sweep > 0.02) {
        const a = now / 650;
        const wedge = ctx.createConicGradient?.(a - 0.9, cx, cy);
        if (wedge) {
          wedge.addColorStop(0, rgba(AMBER, 0));
          wedge.addColorStop(0.14, rgba(AMBER, 0.22 * sweep));
          wedge.addColorStop(0.145, rgba(AMBER, 0));
          wedge.addColorStop(1, rgba(AMBER, 0));
          ctx.fillStyle = wedge;
          ctx.beginPath();
          ctx.arc(cx, cy, ringR - 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // The sphere: rotate, project, draw back-to-front by depth.
      const tilt = 0.38, cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const focal = 3.2;
      for (const p of pts) {
        const ripple = 1 + Math.sin(now / 260 + p.seed * 3) * (0.015 + energy * 0.03 + swell * 0.09);
        let x = (p.x * cosA - p.z * sinA) * ripple;
        let z = (p.x * sinA + p.z * cosA) * ripple;
        let y = p.y * ripple;
        const y2 = y * cosT - z * sinT;
        z = y * sinT + z * cosT; y = y2;
        const scale = focal / (focal + z);
        const depth = (1 - z) / 2; // 1 = nearest
        const px = cx + x * R * scale, py = cy + y * R * scale;
        const twinkle = 0.75 + 0.25 * Math.sin(now / 400 + p.seed * 5);
        ctx.fillStyle = rgba(depth > 0.88 && p.seed > 5.9 ? accent : CYAN, (0.12 + depth * 0.78) * twinkle);
        const d = (0.9 + depth * 1.9) * (size / 520);
        ctx.fillRect(px - d / 2, py - d / 2, d, d);
      }

      // Bright core that pulses with speech.
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
      core.addColorStop(0, rgba([210, 250, 255], 0.22 + energy * 0.18 + swell * 0.3));
      core.addColorStop(1, rgba(CYAN, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.75, 0, Math.PI * 2);
      ctx.fill();

      if (!reduced) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);

  return (
    <button type="button" className="sarah-core" onClick={onActivate} aria-label={label}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </button>
  );
}
