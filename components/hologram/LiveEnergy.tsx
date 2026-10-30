"use client";

import { useEffect, useRef } from "react";
import { smooth } from "./assembly";
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
    const neurons = Array.from({ length: 85 }, () => ({ angle: rand() * Math.PI * 2, radius: Math.sqrt(rand()), phase: rand() * Math.PI * 2 }));
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
        // Brain center: upper cranium, well above the eye line (~36% down).
        const x = width * .5, y = height * .195;
        const radius = width * .145 * pulse;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = core;
        // Keep the red-orange field within the forehead, above the brow.
        ctx.beginPath(); ctx.ellipse(x, y, width * .145, height * .125, 0, 0, Math.PI * 2); ctx.clip();
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `rgba(255,138,22,${.65 * strength})`);
        glow.addColorStop(.3, `rgba(255,79,8,${.48 * strength})`);
        glow.addColorStop(.65, "rgba(239,54,3,.22)");
        glow.addColorStop(1, "rgba(222,100,0,0)");
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        const positions = neurons.map(n => {
          const angle = n.angle + t * .07;
          const r = radius * n.radius * (.83 + Math.sin(t * .7 + n.phase) * .04);
          return { x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r * .8, phase: n.phase };
        });
        positions.forEach((p, i) => {
          ctx.fillStyle = `rgba(255,181,36,${.28 + .22 * Math.sin(t * 2 + p.phase)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, .55, 0, Math.PI * 2); ctx.fill();
          const q = positions[(i + 11) % positions.length];
          if (Math.hypot(p.x - q.x, p.y - q.y) < radius * .42) {
            ctx.strokeStyle = "rgba(255,154,12,.17)"; ctx.lineWidth = .5;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        });
        const heart = ctx.createRadialGradient(x, y, 0, x, y, width * .019);
        heart.addColorStop(0, "rgba(255,255,223,1)");
        heart.addColorStop(.22, "rgba(255,228,134,.96)");
        heart.addColorStop(.5, "rgba(255,176,20,.65)");
        heart.addColorStop(1, "rgba(255,132,0,0)");
        ctx.fillStyle = heart; ctx.beginPath(); ctx.arc(x, y, width * .019, 0, Math.PI * 2); ctx.fill();
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
