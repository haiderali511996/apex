"use client";

import { useEffect, useRef } from "react";
import { smooth } from "./assembly";
import { centreLine, headPose, noddedY } from "./headPose";
import type { VoiceState } from "@/lib/useApexVoice";

type Props = { stage: number; voiceState: VoiceState; reduced: boolean; clock: { current: number } };

/** Runtime energy and motes, independent of the portrait artwork. */
export default function LiveEnergy(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  current.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let width = 1, height = 1, frame = 0;
    let core = 0, dust = 0;
    let last = 0, previousProgress = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); resize();

    let seed = 927;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const motes = Array.from({ length: 1100 }, () => ({ y: rand() * .91 + .035, side: rand() > .5 ? 1 : -1, offset: rand() * .055, phase: rand(), speed: .055 + rand() * .065 }));

    const draw = (now: number) => {
      const state = current.current;
      if (state.clock.current < previousProgress) { core = 0; dust = 0; }
      previousProgress = state.clock.current;
      const dt = Math.min((now - last) / 1000 || .016, .05);
      last = now;
      const t = state.reduced ? 0 : now / 1000;
      const rate = state.voiceState === "speaking" ? 4.8 : state.voiceState === "thinking" ? 3.2 : 1.3;
      const strength = state.voiceState === "speaking" ? 1.22 : state.voiceState === "thinking" ? 1.1 : .85;
      const pulse = state.reduced ? 1 : 1 + Math.sin(t * rate) * .13;
      const approach = state.reduced ? 1 : 1 - Math.exp(-dt * 3);
      core += ((smooth((state.clock.current - 4.1) / .8)) - core) * approach;
      dust += ((smooth(state.clock.current - 5)) - dust) * approach;
      ctx.clearRect(0, 0, width, height);

      if (core > .001) {
        // A broad amber field lives on the forehead, with no point-light core.
        const turn = centreLine(headPose.yaw, .5);
        const x = width * turn.x;
        const y = height * noddedY(.225, headPose.pitch, .5);
        const radiusX = width * .147 * turn.squash;
        const top = noddedY(.105, headPose.pitch, .5);
        const bottom = noddedY(.325, headPose.pitch, .5);
        const radiusY = height * (bottom - top) * .5;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = core;

        // Draw in elliptical coordinates so the light fits between hairline
        // and brows. The feathered edge keeps the cyan face lines visible.
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(radiusX, radiusY);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        glow.addColorStop(0, `rgba(255,174,24,${.56 * strength * pulse})`);
        glow.addColorStop(.36, `rgba(255,157,12,${.52 * strength * pulse})`);
        glow.addColorStop(.64, `rgba(248,137,8,${.34 * strength})`);
        glow.addColorStop(.84, "rgba(232,139,17,.12)");
        glow.addColorStop(1, "rgba(232,139,17,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();

        // Warm, gently curved scan lines spread the energy across the skin
        // instead of concentrating it into a bright dot or neural sparks.
        const lineGlow = ctx.createLinearGradient(x - radiusX, 0, x + radiusX, 0);
        lineGlow.addColorStop(0, "rgba(255,181,41,0)");
        lineGlow.addColorStop(.25, "rgba(255,185,48,.25)");
        lineGlow.addColorStop(.5, "rgba(255,199,72,.42)");
        lineGlow.addColorStop(.75, "rgba(255,185,48,.25)");
        lineGlow.addColorStop(1, "rgba(255,181,41,0)");
        ctx.strokeStyle = lineGlow;
        ctx.lineWidth = Math.max(.7, height * .0014);
        for (let row = 0; row < 12; row++) {
          const v = (row + .5) / 12;
          ctx.globalAlpha = core * Math.sin(v * Math.PI) * strength * pulse;
          const lineY = y + (v * 2 - 1) * radiusY * .85;
          const halfWidth = radiusX * Math.sqrt(1 - (v * 2 - 1) ** 2);
          ctx.beginPath();
          ctx.moveTo(x - halfWidth, lineY);
          ctx.bezierCurveTo(x - halfWidth * .45, lineY - height * .006,
            x + halfWidth * .35, lineY + height * .012, x + halfWidth, lineY);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (dust > .001) {
        ctx.save(); ctx.globalCompositeOperation = "screen";
        motes.forEach(m => {
          const cycle = (m.phase + t * m.speed) % 1;
          const y = m.y - cycle * .065 + Math.sin(t * .8 + m.phase * 12) * .003;
          const edge = y < .59 ? .17 * Math.sqrt(Math.max(0, 1 - ((y - .31) / .30) ** 2)) : y < .72 ? .15 : .15 + (y - .72) * 1.1;
          const x = .5 + m.side * (edge + m.offset + cycle * .045 + Math.sin(t + m.phase * 10) * .003);
          ctx.fillStyle = `rgba(73,222,244,${Math.sin(cycle * Math.PI) * dust * .85})`;
          ctx.beginPath(); ctx.arc(x * width, y * height, .45 + m.phase * .95, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
      }
      if (!state.reduced) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [props.reduced, props.reduced ? props.stage : null]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 6, pointerEvents: "none" }} />;
}
