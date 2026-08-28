"use client";

/**
 * Imex's face — a bust rendered as a dot matrix on canvas.
 *
 * The figure is sampled on a regular grid clipped to a human silhouette, so
 * the surface reads as rows of points the way the reference does. Three things
 * carry the look:
 *
 *  - a bright continuous rim, from points sitting within a few units of the
 *    silhouette edge;
 *  - flow lines — arcs fanning across the chest from the base of the neck, and
 *    horizontal banding across the skull — drawn by modulating brightness
 *    rather than by moving points, so the grid stays intact;
 *  - a warm core at the face and gold filaments up the sternum, whose
 *    brightness follows the voice.
 *
 * Every point springs to its target from a scattered start, so the bust
 * assembles out of dust when the screen opens. Canvas rather than SVG:
 * this is ~12k independently moving points.
 */

import { useEffect, useRef, useState } from "react";
import type { VoiceState } from "@/lib/useApexVoice";

/* ── silhouette, in bust-space units around the origin ──────────────────── */

const HEAD = { cx: 0, cy: -168, rx: 116, ry: 152 };
const JAW = -20;          // where the head ends and the neck begins
const NECK_BOTTOM = 66;
const SHOULDER_SPAN = 250;
const BODY_END = 400;

const FACE = { cx: 0, cy: -150, rx: 78, ry: 92 };

/** Where the figure streams out of — a bright point under the sternum. */
const EMIT = { x: 0, y: 352 };
const BUILD_SECONDS = 5.0;

function headHalfWidth(y: number): number {
  const t = (y - HEAD.cy) / HEAD.ry;
  if (Math.abs(t) >= 1) return 0;
  // Cheeks stay wide, then the jaw draws in.
  const taper = t > 0.35 ? 1 - Math.pow((t - 0.35) / 0.65, 2) * 0.42 : 1;
  return HEAD.rx * Math.sqrt(1 - t * t) * taper;
}

function neckHalfWidth(y: number): number {
  const k = (y - JAW) / (NECK_BOTTOM - JAW);
  return 54 + k * 14;
}

function shoulderHalfWidth(y: number): number {
  const k = Math.min(1, (y - NECK_BOTTOM) / SHOULDER_SPAN);
  return 68 + Math.sin((k * Math.PI) / 2) * 244;
}

/** Half-width of the whole bust at a given y, or 0 outside it. */
function halfWidthAt(y: number): number {
  if (y < JAW) return headHalfWidth(y);
  if (y < NECK_BOTTOM) {
    // The trapezius starts before the neck ends, so take the wider of the two.
    return Math.max(neckHalfWidth(y), y > NECK_BOTTOM - 26 ? shoulderHalfWidth(y) * 0.5 : 0);
  }
  return shoulderHalfWidth(y);
}

type P = {
  tx: number; ty: number;
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  /** 0..1 base brightness from the surface shading. */
  lit: number;
  rim: boolean;
  core: boolean;
  gold: boolean;
  /** Precomputed radial falloff for core particles. */
  coreG: number;
  phase: number;
  depth: number;
  /** 0..1 point in the build when this particle leaves the emitter. */
  delay: number;
  released: boolean;
  /** Tangential kick on release — what bends the stream into a ribbon. */
  swirl: number;
};

const STEP = 2.15;

function buildParticles(): P[] {
  const ps: P[] = [];
  const push = (p: Omit<P, "x" | "y" | "vx" | "vy" | "phase" | "delay" | "released" | "swirl" | "coreG">) =>
    ps.push({
      ...p, x: 0, y: 0, vx: 0, vy: 0,
      coreG: p.core
        ? Math.max(0, 1 - Math.hypot((p.tx - FACE.cx) / FACE.rx, (p.ty - FACE.cy) / FACE.ry))
        : 0,
      phase: Math.random() * Math.PI * 2, delay: 0, released: false, swirl: 0,
    });

  for (let y = HEAD.cy - HEAD.ry; y < BODY_END; y += STEP) {
    const w = halfWidthAt(y);
    if (w < 2) continue;

    for (let x = -w; x <= w; x += STEP) {
      const edgeDist = w - Math.abs(x);
      const rim = edgeDist < 3.2;

      // Skip the odd interior point so the matrix breathes.
      if (!rim && Math.random() < 0.06) continue;

      const inFace =
        Math.pow((x - FACE.cx) / FACE.rx, 2) + Math.pow((y - FACE.cy) / FACE.ry, 2) < 1;

      let lit: number;
      if (rim) {
        lit = 1;
      } else if (y < JAW) {
        // Horizontal banding across the skull.
        lit = 0.42 + 0.34 * Math.pow(Math.sin(y * 0.42), 2) + (1 - Math.abs(x) / w) * 0.08;
      } else {
        // Arcs fanning out from the base of the neck across the chest.
        const r = Math.hypot(x * 0.82, (y - NECK_BOTTOM + 8) * 1.25);
        lit = 0.26 + 0.42 * Math.pow(Math.sin(r * 0.085), 2);
      }

      // Gold filaments climbing the sternum into the throat.
      const sternum =
        y > NECK_BOTTOM - 34 &&
        y < NECK_BOTTOM + 132 &&
        Math.abs(Math.abs(x) - (y - NECK_BOTTOM + 44) * 0.3) < 3.2 &&
        Math.abs(x) < 62;

      push({
        tx: x + (Math.random() - 0.5) * 0.5,
        ty: y + (Math.random() - 0.5) * 0.5,
        size: rim ? 1 : 1,
        lit,
        rim,
        core: inFace && y < JAW,
        gold: sternum,
        depth: rim ? 0.55 : inFace ? 0.9 : 0.35,
      });
    }
  }

  // Spray off the crown and along the shoulders.
  for (let i = 0; i < 420; i++) {
    const crown = Math.random() < 0.6;
    const a = crown
      ? -Math.PI / 2 + (Math.random() - 0.5) * 1.9
      : (Math.random() < 0.5 ? Math.PI : 0) + (Math.random() - 0.5) * 0.9;
    const d = (crown ? HEAD.ry : 250) + Math.random() * 90;
    push({
      tx: Math.cos(a) * d * (crown ? 0.7 : 1.02),
      ty: (crown ? HEAD.cy : 190) + Math.sin(a) * d * (crown ? 1 : 0.35),
      size: 0.8 + Math.random() * 1.1,
      lit: 0.25 + Math.random() * 0.55,
      rim: false, core: false, gold: false,
      depth: 0.18,
    });
  }

  return ps;
}

export default function ImexFace({
  state,
  onClose,
}: {
  state: VoiceState;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgressState] = useState(0);
  // Throttled to whole percent — the canvas runs at 60fps, the label needn't.
  const lastPct = useRef(-1);
  const setProgress = (v: number) => {
    const pct = Math.min(100, Math.round(v * 100));
    if (pct !== lastPct.current) { lastPct.current = pct; setProgressState(pct); }
  };
  const stateRef = useRef<VoiceState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles = buildParticles();
    const gaze = { x: 0, y: 0, tx: 0, ty: 0 };

    // Everything is born at a single point below the sternum and streams out
    // of it. Release is ordered by angle around that point, which is what
    // makes the build sweep round as a ribbon instead of popping into place.
    for (const p of particles) {
      const ang = Math.atan2(p.ty - EMIT.y, p.tx - EMIT.x);
      const sweep = (ang + Math.PI * 1.5) / (Math.PI * 2);
      p.delay = (sweep - Math.floor(sweep)) * 0.62 + Math.random() * 0.12;
      p.swirl = (p.tx < 0 ? -1 : 1) * (0.5 + Math.random() * 0.55);
      p.released = false;
      p.x = EMIT.x + (Math.random() - 0.5) * 5;
      p.y = EMIT.y + (Math.random() - 0.5) * 5;
    }
    if (reduced) for (const p of particles) { p.x = p.tx; p.y = p.ty; p.released = true; }

    let w = 0, h = 0, scale = 1, dpr = 1;
    // The gradient ground is fixed, so it is rasterised once and memcpy'd in
    // each frame. Reading the canvas back with getImageData every frame was
    // costing ~250ms and pinning the loop at a few frames a second.
    let frame: ImageData | null = null;
    let ground: Uint8ClampedArray | null = null;

    const resize = () => {
      // 1.5 is plenty for glowing dots and keeps the pixel buffer a third
      // smaller than a full retina one.
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      scale = Math.min(w / 900, h / 900);

      const bg = ctx.createRadialGradient(
        canvas.width / 2, canvas.height * 0.42, 0,
        canvas.width / 2, canvas.height * 0.42, canvas.width * 0.75
      );
      bg.addColorStop(0, "#0d2233");
      bg.addColorStop(0.55, "#081726");
      bg.addColorStop(1, "#040c15");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      ground = new Uint8ClampedArray(frame.data);
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      gaze.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      gaze.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMove);

    let raf = 0, t = 0, voice = 0;
    let build = reduced ? 1 : 0; // 0..1 assembly progress

    const draw = () => {
      t += 0.016;
      const speaking = stateRef.current === "speaking";
      const listening = stateRef.current === "listening";
      voice += ((speaking ? 1 : 0) - voice) * 0.09;

      gaze.x += (gaze.tx - gaze.x) * 0.06;
      gaze.y += (gaze.ty - gaze.y) * 0.06;

      if (build < 1) build = Math.min(1, build + 0.016 / BUILD_SECONDS);
      if (!frame || !ground) { raf = requestAnimationFrame(draw); return; }
      frame.data.set(ground);

      const originY = h / 2 + 8 * scale;

      // Particles are written straight into the pixel buffer: ~70k points is
      // far more than fillRect can push at frame rate, and this also gives
      // real additive blending for the bloom.
      const buf = frame.data;
      const cw = canvas.width, chh = canvas.height;
      const ox = (w / 2) * dpr, oy = originY * dpr, sc = scale * dpr;

      const plot = (fx: number, fy: number, r: number, g: number, bl: number, a: number) => {
        const xi = fx | 0, yi = fy | 0;
        if (xi < 0 || yi < 0 || xi >= cw || yi >= chh) return;
        const i = (yi * cw + xi) << 2;
        buf[i] = Math.min(255, buf[i] + r * a);
        buf[i + 1] = Math.min(255, buf[i + 1] + g * a);
        buf[i + 2] = Math.min(255, buf[i + 2] + bl * a);
      };

      for (const p of particles) {
        const px = gaze.x * (9 + p.depth * 24);
        const py = gaze.y * (5 + p.depth * 14);

        const wave = p.core
          ? Math.sin(p.ty * 0.14 + t * (2 + voice * 4.5) + p.phase) * (0.8 + voice * 4.2)
          : Math.sin(p.ty * 0.05 + t * 0.6 + p.phase) * 0.45;

        const tx = p.tx + px + wave;
        const ty = p.ty + py;

        if (reduced) {
          p.x = tx; p.y = ty;
        } else {
          if (!p.released) {
            if (build < p.delay) {
              // Still inside the emitter, jostling.
              p.x = EMIT.x + (Math.random() - 0.5) * 6;
              p.y = EMIT.y + (Math.random() - 0.5) * 6;
              continue;
            }
            // Launch across the target rather than at it, so the spring bends
            // the path into an arc instead of a straight line.
            p.released = true;
            const a0 = Math.atan2(p.ty - EMIT.y, p.tx - EMIT.x) + p.swirl;
            const speed = 7 + Math.random() * 7;
            p.vx = Math.cos(a0) * speed;
            p.vy = Math.sin(a0) * speed;
          }
          p.vx = (p.vx + (tx - p.x) * 0.055) * 0.87;
          p.vy = (p.vy + (ty - p.y) * 0.055) * 0.87;
          p.x += p.vx;
          p.y += p.vy;
        }

        const sx = ox + p.x * sc;
        const sy = oy + p.y * sc;
        const shimmer = 0.88 + 0.12 * Math.sin(t * 1.6 + p.phase);

        if (p.core) {
          const g = p.coreG * (0.8 + voice * 0.4);
          const a = Math.min(1, 0.3 + g * 0.8);
          plot(sx, sy, 255, 165 + g * 70, 35 + g * 55, a);
          if (g > 0.45) {
            plot(sx + 1, sy, 255, 175, 55, a * 0.4);
            plot(sx, sy + 1, 255, 175, 55, a * 0.4);
          }
          continue;
        }

        if (p.gold) {
          const a = (0.5 + voice * 0.4) * shimmer;
          plot(sx, sy, 255, 180 + voice * 40, 80, a);
          plot(sx + 1, sy, 255, 180, 80, a * 0.45);
          continue;
        }

        if (p.rim) {
          // Bloom first, then the hot point on top of it.
          const a = 0.95 * shimmer;
          plot(sx - 1, sy, 70, 200, 255, 0.1);
          plot(sx + 2, sy, 70, 200, 255, 0.1);
          plot(sx, sy - 1, 70, 200, 255, 0.1);
          plot(sx, sy + 2, 70, 200, 255, 0.1);
          plot(sx, sy, 210, 250, 255, a);
          plot(sx + 1, sy, 150, 235, 255, a * 0.5);
          plot(sx, sy + 1, 150, 235, 255, a * 0.5);
          continue;
        }

        const a = p.lit * shimmer * 0.85;
        plot(sx, sy, 40 + p.lit * 70, 190 + p.lit * 55, 230 + p.lit * 25, a);
      }

      ctx.putImageData(frame, 0, 0);

      // Halo and emitter go on top with ordinary canvas ops — a handful of
      // strokes, far cheaper than folding them into the pixel loop.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0,190,255,${(listening ? 0.3 : speaking ? 0.2 : 0.12) * (1 - i / 10) * build})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([1.5, 10]);
        ctx.lineDashOffset = (i % 2 ? -t : t) * (14 + i * 3);
        ctx.arc(w / 2 + gaze.x * 5, originY + HEAD.cy * scale + gaze.y * 3, (170 + i * 23) * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();

      // The emitter: bright while the figure streams out of it, gone once the
      // build finishes.
      const emitAlpha = build < 1 ? 1 : Math.max(0, 1 - (build - 1) * 4);
      if (emitAlpha > 0.01) {
        const ex = w / 2 + EMIT.x * scale;
        const ey = originY + EMIT.y * scale;
        const r = 46 * scale;
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r);
        g.addColorStop(0, `rgba(235,252,255,${0.95 * emitAlpha})`);
        g.addColorStop(0.22, `rgba(90,205,255,${0.75 * emitAlpha})`);
        g.addColorStop(0.6, `rgba(30,140,235,${0.28 * emitAlpha})`);
        g.addColorStop(1, "rgba(10,60,140,0)");
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      setProgress(build);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  const statusText =
    state === "speaking" ? "STATUS: SPEAKING"
    : state === "listening" ? "STATUS: LISTENING"
    : state === "thinking" ? "STATUS: PROCESSING"
    : "STATUS: IDLE";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "#04080f" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Imex — ${statusText.toLowerCase()}`}
        style={{ width: "100%", height: "100%", display: "block" }}
      />

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
          position: "absolute", top: "58%", right: "clamp(18px,7vw,120px)", zIndex: 95,
          fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.22em",
          color: "rgba(0,229,255,0.72)", pointerEvents: "none", whiteSpace: "pre",
        }}
      >
        {progress < 100 ? `ASSEMBLING....  ${progress}%` : statusText}
      </div>
    </div>
  );
}
