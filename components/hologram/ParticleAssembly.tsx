"use client";

import { useEffect, useRef } from "react";
import { arrivalTime, ASSEMBLY_SECONDS, clamp01, PORTRAIT_FRAME, smooth } from "./assembly";

type Props = {
  image: HTMLImageElement;
  playing: boolean;
  replay: number;
  reduced: boolean;
  clock: { current: number };
  onStage: (stage: number) => void;
  onComplete: () => void;
};
type Mote = { x: number; y: number; arrival: number; duration: number; seed: number; size: number; color: number };
const COLORS = ["#38d8fa", "#c0f7ff", "#ffc16a"];

/** Persistent particles rise from one emitter and deposit one registered portrait. */
export default function ParticleAssembly(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef(props); current.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = 640, h = Math.round(w * props.image.naturalHeight * 3 / (props.image.naturalWidth * 2));
    const makeCanvas = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const texture = makeCanvas(), textureCtx = texture.getContext("2d")!;
    const tileW = props.image.naturalWidth / 3, tileH = props.image.naturalHeight / 2;
    textureCtx.drawImage(props.image, PORTRAIT_FRAME % 3 * tileW, Math.floor(PORTRAIT_FRAME / 3) * tileH, tileW, tileH, 0, 0, w, h);
    const pixels = textureCtx.getImageData(0, 0, w, h).data;
    let seed = 714;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const candidates: Mote[] = [];
    for (let y = 8; y < h - 4; y += 2) for (let x = 5; x < w - 5; x += 2) {
      const i = (y * w + x) * 4;
      if (Math.max(pixels[i], pixels[i + 1]) < 54 || pixels[i + 1] + pixels[i + 2] < 100) continue;
      const warm = pixels[i] > pixels[i + 2] * 1.5;
      candidates.push({ x, y, color: warm ? 2 : random() > .72 ? 1 : 0,
        arrival: arrivalTime(x / w, y / h) + random() * .055,
        duration: .19 + random() * .07, seed: random(), size: .35 + random() * .6 });
    }
    // Deterministic sampling keeps replay and resize from changing the figure.
    const particles = Array.from({ length: Math.min(11000, candidates.length) }, () => candidates[Math.floor(random() * candidates.length)]);
    const cloud = Array.from({ length: 650 }, () => ({ seed: random(), spread: random(), size: .35 + random() * .6 }));
    const columns = 96, rows = Math.ceil(h / 7);
    const arrivals = Array.from({ length: columns * rows }, (_, i) => arrivalTime((i % columns + .5) / columns, (Math.floor(i / columns) + .5) / rows));
    const reveal = makeCanvas(), mask = makeCanvas();
    mask.width = columns; mask.height = rows;
    const revealCtx = reveal.getContext("2d")!, maskCtx = mask.getContext("2d")!;
    const maskPixels = maskCtx.createImageData(columns, rows);
    maskPixels.data.fill(255);
    let width = 1, height = 1, frame = 0, start = performance.now(), lastStage = -1;
    let lastReplay = current.current.replay, wasPlaying = current.current.playing, completed = false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();

    const draw = (now: number) => {
      const state = current.current;
      if (state.replay !== lastReplay || state.playing && !wasPlaying) {
        start = now; completed = false; lastReplay = state.replay;
      }
      wasPlaying = state.playing;
      const p = state.reduced || !state.playing ? 1 : clamp01((now - start) / (ASSEMBLY_SECONDS * 1000));
      const progress = p * 6, stage = Math.min(5, Math.floor(progress));
      state.clock.current = progress;
      if (stage !== lastStage) { lastStage = stage; state.onStage(stage); }
      canvas.dataset.assemblyProgress = progress.toFixed(3);
      canvas.dataset.assemblyPhase = String(stage + 1);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#020d18"; ctx.fillRect(0, 0, width, height);
      if (p >= 1) {
        ctx.drawImage(texture, 0, 0, width, height);
      } else {
        // A soft moving front follows the particles. Never swap sprite-sheet tiles.
        for (let i = 0; i < arrivals.length; i++) maskPixels.data[i * 4 + 3] = smooth((p - arrivals[i] - .025) / .125) * 255;
        maskCtx.putImageData(maskPixels, 0, 0);
        revealCtx.globalCompositeOperation = "source-over";
        revealCtx.clearRect(0, 0, w, h); revealCtx.drawImage(texture, 0, 0);
        revealCtx.globalCompositeOperation = "destination-in";
        revealCtx.filter = "blur(5px)"; revealCtx.drawImage(mask, 0, 0, w, h); revealCtx.filter = "none";
        revealCtx.globalCompositeOperation = "source-over";
        ctx.save(); ctx.globalAlpha = smooth((p - .20) / .40);
        ctx.drawImage(reveal, 0, 0, width, height); ctx.restore();
        ctx.save(); ctx.scale(width / w, height / h); ctx.globalCompositeOperation = "screen";
        const t = (now - start) / 1000;
        const fade = 1 - smooth((p - .88) / .12);
        // Batch the point field into 24 draws instead of thousands of canvas calls.
        const dots = Array.from({ length: COLORS.length * 8 }, () => new Path2D());
        const dot = (x: number, y: number, size: number, alpha: number, color: number) => {
          const opacity = Math.round(clamp01(alpha) * 7);
          if (opacity > 0) dots[color * 8 + opacity].rect(x, y, size, size);
        };
        // One compact, curling cloud feeds the rising stream from the chest core.
        for (const mote of cloud) {
          const angle = mote.seed * Math.PI * 2 + t * 1.8;
          const radius = (9 + mote.spread * 60) * (.35 + smooth(p / .18) * .65);
          const x = w * .5 + Math.cos(angle) * radius;
          const y = h * .925 + Math.sin(angle) * radius * .23 - mote.spread * smooth(p / .2) * 20;
          dot(x, y, mote.size, (.2 + mote.spread * .5) * fade, mote.seed > .8 ? 1 : 0);
        }
        for (const mote of particles) {
          const flight = (p - (mote.arrival - mote.duration)) / mote.duration;
          if (flight <= 0) continue;
          if (flight >= 1) {
            // Settled dots persist while the matching light contours grow through them.
            const alpha = (1 - smooth((p - mote.arrival - .045) / .17)) * .85;
            dot(mote.x, mote.y, mote.size, alpha, mote.color);
            continue;
          }
          const u = smooth(flight), remaining = 1 - u;
          const turns = mote.seed * Math.PI * 2 + flight * Math.PI * 2.3;
          const curl = Math.sin(flight * Math.PI) * (22 + mote.seed * 36);
          const side = mote.x < w * .5 ? -1 : 1;
          const x = w * .5 * remaining + mote.x * u + side * Math.sin(flight * Math.PI) * w * .15 + Math.cos(turns) * curl * remaining;
          const y = h * .925 * remaining + mote.y * u - Math.sin(flight * Math.PI) * h * .09 + Math.sin(turns) * curl * .32;
          dot(x, y, mote.size * (1 + remaining * .3), smooth(flight / .12) * (.45 + .45 * u) * fade, mote.color);
        }
        dots.forEach((path, i) => { ctx.fillStyle = COLORS[Math.floor(i / 8)]; ctx.globalAlpha = i % 8 / 7; ctx.fill(path); });
        // Cyan ignition fades away as the warm forehead core takes over.
        const emitter = 1 - smooth((p - .68) / .24);
        const radius = 25 + Math.sin(t * 3) * 2;
        const glow = ctx.createRadialGradient(w * .5, h * .925, 0, w * .5, h * .925, radius);
        glow.addColorStop(0, `rgba(220,255,255,${emitter})`);
        glow.addColorStop(.10, `rgba(119,242,255,${emitter})`);
        glow.addColorStop(.3, `rgba(0,180,255,${emitter * .8})`);
        glow.addColorStop(1, "rgba(0,135,255,0)");
        ctx.globalAlpha = 1; ctx.fillStyle = glow;
        ctx.fillRect(w * .5 - radius, h * .925 - radius, radius * 2, radius * 2);
        ctx.restore();
      }
      if (p >= 1 && state.playing && !completed) { completed = true; state.onComplete(); }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [props.image]);

  return <canvas ref={canvasRef} aria-hidden="true" data-assembly-progress="0" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}
