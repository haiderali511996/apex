"use client";

import { useEffect, useRef } from "react";
import { PORTRAIT_FRAME } from "./assembly";
import { readSpeechMotion } from "@/lib/speechMotion";

type Props = { image: HTMLImageElement; clock: { current: number }; reduced: boolean };

/** Deform the portrait's own lip texture around a small, dark mouth opening. */
export default function TalkingMouth(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  current.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let width = 1, height = 1, frame = 0, last = 0, open = 0, lipWidth = 1, round = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      const dt = Math.min((now - last) / 1000 || .033, .08); last = now;
      const state = current.current;
      const motion = readSpeechMotion();
      const target = motion.active && state.clock.current >= 5.7 && !state.reduced ? motion.open : 0;
      open += (target - open) * (1 - Math.exp(-dt * 24));
      lipWidth += (motion.width - lipWidth) * (1 - Math.exp(-dt * 20));
      round += (motion.round - round) * (1 - Math.exp(-dt * 20));
      canvas.dataset.mouthOpen = open.toFixed(3);
      canvas.dataset.speechActive = String(motion.active);
      ctx.clearRect(0, 0, width, height);
      if (open < .009 || state.clock.current < 5.7) return;

      const image = state.image;
      const tileW = image.naturalWidth / 3, tileH = image.naturalHeight / 2;
      const artFrame = PORTRAIT_FRAME;
      const scaleY = 1, offsetY = 0;
      const sourceX = artFrame % 3 * tileW, sourceY = Math.floor(artFrame / 3) * tileH;
      const cx = .5, cy = .515;
      const displayY = (cy * scaleY + offsetY) * height;
      const halfW = .105, halfH = .068;
      const opening = open * .014 * height;
      // The oral cavity is revealed between the upper and lower lip textures.
      ctx.fillStyle = "#00070e";
      ctx.beginPath(); ctx.ellipse(cx * width, displayY, width * .052 * lipWidth, opening + height * .002, 0, 0, Math.PI * 2); ctx.fill();
      // A faint internal contour keeps the opening part of the hologram.
      ctx.strokeStyle = "rgba(39,155,178,.24)"; ctx.lineWidth = .65;
      ctx.beginPath(); ctx.ellipse(cx * width, displayY + opening * .45, width * .041 * lipWidth, opening * .35, 0, 0, Math.PI); ctx.stroke();

      const columns = 28, rowsPerHalf = 22;
      for (let col = 0; col < columns; col++) {
        const x0 = cx - halfW + col / columns * halfW * 2;
        const x1 = cx - halfW + (col + 1) / columns * halfW * 2;
        const nx = ((x0 + x1) / 2 - cx) / (halfW * (.52 - round * .06));
        const xWeight = Math.exp(-Math.pow(nx, 4));
        for (const side of [-1, 1]) {
          for (let row = 0; row < rowsPerHalf; row++) {
            const y0 = cy + side * (row / rowsPerHalf * halfH + .0003);
            const y1 = cy + side * ((row + 1) / rowsPerHalf * halfH + .0003);
            const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
            const displacement = (y: number) => side * opening * xWeight * Math.pow(Math.max(0, 1 - Math.abs(y - cy) / halfH), 2);
            const destTop = (top * scaleY + offsetY) * height + displacement(top), destBottom = (bottom * scaleY + offsetY) * height + displacement(bottom);
            ctx.drawImage(image, sourceX + x0 * tileW, sourceY + top * tileH, (x1 - x0) * tileW, (bottom - top) * tileH,
              x0 * width, destTop, (x1 - x0) * width + .4, destBottom - destTop + .35);
          }
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [props.image]);

  return <canvas ref={canvasRef} aria-hidden="true" data-mouth-open="0" data-speech-active="false" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 5, pointerEvents: "none" }} />;
}
