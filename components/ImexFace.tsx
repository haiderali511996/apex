"use client";

/**
 * Imex's face: a cyan wireframe bust drawn as horizontal contour slices, with
 * a warm energy core where the face would be. The core's bands ripple while
 * Imex speaks and settle when it listens, so the state is readable across a
 * room without looking at any text.
 *
 * Built the same way as the orb — hand-written SVG, no 3D — so it stays sharp
 * at any size and costs nothing to animate.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { VoiceState } from "@/lib/useApexVoice";

const CYAN = "#00e5ff";
const CYAN_SOFT = "#4fd8ff";
const GOLD = "#ff9d2e";
const GOLD_HOT = "#ffe08a";

const VB_W = 600;
const VB_H = 700;

const HEAD = { cx: 300, cy: 232, rx: 82, ry: 118 };
const FACE = { cx: 300, cy: 250, rx: 52, ry: 70 };

const NECK_TOP = 336;
const NECK_BOTTOM = 398;
const SHOULDER_END = 700;

/** Half-width of the head silhouette at a given y, or 0 outside it. */
function headHalfWidth(y: number): number {
  const t = (y - HEAD.cy) / HEAD.ry;
  if (Math.abs(t) >= 1) return 0;
  // Narrower towards the chin, the way a jaw tapers.
  const taper = t > 0 ? 1 - t * t * 0.3 : 1;
  return HEAD.rx * Math.sqrt(1 - t * t) * taper;
}

/**
 * Half-width of the neck and shoulders. The shoulders flare fast just below
 * the neck and then flatten, which is what makes it read as a bust rather
 * than a cone.
 */
function bodyHalfWidth(y: number): number {
  if (y < NECK_BOTTOM) {
    const k = (y - NECK_TOP) / (NECK_BOTTOM - NECK_TOP);
    return 34 + k * 10;
  }
  // Shoulders round out over ~220px and then run straight down out of frame,
  // which is what stops the bust reading as a bell.
  const k = Math.min(1, (y - NECK_BOTTOM) / 220);
  return 44 + Math.sin((k * Math.PI) / 2) * 152;
}

export default function ImexFace({
  state,
  onClose,
}: {
  state: VoiceState;
  onClose: () => void;
}) {
  const speaking = state === "speaking";
  const listening = state === "listening";

  /**
   * Imex turns toward the cursor. Each layer shifts by a different amount —
   * the core most, the halo least — so the parallax reads as a head turning
   * rather than a picture sliding around. Updates are coalesced into one
   * animation frame so a fast mouse can't flood React with renders.
   */
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  const pending = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // -1..1 from the centre of the viewport, eased so the extremes are gentle.
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      pending.current = {
        x: Math.sign(nx) * Math.pow(Math.min(1, Math.abs(nx)), 0.8),
        y: Math.sign(ny) * Math.pow(Math.min(1, Math.abs(ny)), 0.8),
      };
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setGaze(pending.current);
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const bustShift = `translate(${gaze.x * 11} ${gaze.y * 7})`;
  const coreShift = `translate(${gaze.x * 21} ${gaze.y * 13})`;
  const haloShift = `translate(${gaze.x * 4} ${gaze.y * 2.5})`;
  // A touch of horizontal squash on the far side sells the turn.
  const turn = `scale(${1 - Math.abs(gaze.x) * 0.045} 1)`;
  const ease = { transition: "transform .28s cubic-bezier(.22,.7,.3,1)" } as const;

  // Contour slices for the head, and for the neck/shoulders.
  const headLines = useMemo(() => {
    const lines: { y: number; w: number }[] = [];
    for (let y = HEAD.cy - HEAD.ry + 3; y < NECK_TOP + 6; y += 5.5) {
      const w = headHalfWidth(y);
      if (w > 2) lines.push({ y, w });
    }
    return lines;
  }, []);

  const bodyLines = useMemo(() => {
    const lines: { y: number; w: number }[] = [];
    for (let y = NECK_TOP; y < SHOULDER_END + 20; y += 5.5) lines.push({ y, w: bodyHalfWidth(y) });
    return lines;
  }, []);

  /** The glowing rim: head silhouette down into the shoulder line. */
  const rimPath = useMemo(() => {
    const left: string[] = [];
    const right: string[] = [];
    for (let y = HEAD.cy - HEAD.ry + 2; y < NECK_TOP; y += 4) {
      const w = headHalfWidth(y);
      if (w < 2) continue;
      left.push(`${HEAD.cx - w},${y}`);
      right.push(`${HEAD.cx + w},${y}`);
    }
    for (let y = NECK_TOP; y <= SHOULDER_END + 18; y += 4) {
      const w = bodyHalfWidth(y);
      left.push(`${HEAD.cx - w},${y}`);
      right.push(`${HEAD.cx + w},${y}`);
    }
    return { left: `M ${left.join(" L ")}`, right: `M ${right.join(" L ")}` };
  }, []);

  // Wavy bands inside the face core.
  const faceBands = useMemo(() => {
    const bands: { y: number; w: number; i: number }[] = [];
    let i = 0;
    for (let y = FACE.cy - FACE.ry + 6; y < FACE.cy + FACE.ry - 4; y += 7) {
      const t = (y - FACE.cy) / FACE.ry;
      const w = FACE.rx * Math.sqrt(Math.max(0, 1 - t * t));
      if (w > 4) bands.push({ y, w, i: i++ });
    }
    return bands;
  }, []);

  const halo = useMemo(
    () => Array.from({ length: 12 }, (_, i) => 138 + i * 17),
    []
  );

  const statusText = speaking
    ? "STATUS: SPEAKING   INTENSITY: HIGH"
    : listening
    ? "STATUS: LISTENING"
    : state === "thinking"
    ? "STATUS: PROCESSING"
    : "STATUS: STANDBY";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 90,
        background: "radial-gradient(ellipse 80% 70% at 50% 42%, #0b2036 0%, #071523 45%, #04080f 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
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

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label={`Imex — ${statusText.toLowerCase()}`}
        style={{
          width: "min(100%, 720px)", height: "100%", display: "block",
          // The bust gathers itself out of the dark rather than snapping in.
          animation: "imexAssemble 1.15s cubic-bezier(.16,.9,.3,1) both",
        }}
      >
        {/* Sized down inside the frame so the halo and motes have room. */}
        <g transform="translate(300 330) scale(.8) translate(-300 -330)">
        <defs>
          <radialGradient id="imexFaceCore" cx="50%" cy="52%" r="52%">
            <stop offset="0%" stopColor={GOLD_HOT} stopOpacity="0.98" />
            <stop offset="42%" stopColor={GOLD} stopOpacity="0.82" />
            <stop offset="78%" stopColor="#e2571b" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#c03a10" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="imexEdge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN_SOFT} stopOpacity="0.95" />
            <stop offset="55%" stopColor={CYAN} stopOpacity="0.8" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0.25" />
          </linearGradient>

          <filter id="imexGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="imexCoreGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="11" />
          </filter>

          <clipPath id="imexFaceClip">
            <ellipse cx={FACE.cx} cy={FACE.cy} rx={FACE.rx} ry={FACE.ry} />
          </clipPath>
        </defs>

        {/* halo — concentric rings behind the head, brightest while listening */}
        <g transform={haloShift} opacity={listening ? 0.8 : speaking ? 0.5 : 0.34} style={{ ...ease, transition: "opacity .6s ease, transform .28s cubic-bezier(.22,.7,.3,1)" }}>
          {halo.map((r, i) => (
            <circle
              key={r}
              cx={HEAD.cx}
              cy={HEAD.cy + 6}
              r={r}
              fill="none"
              stroke={CYAN}
              strokeWidth={i % 3 === 0 ? 1.1 : 0.6}
              strokeOpacity={0.62 - i * 0.03}
              strokeDasharray={i % 2 === 0 ? "1.5 7" : "1 11"}
              style={{
                transformOrigin: `${HEAD.cx}px ${HEAD.cy + 6}px`,
                animation: `imexHalo ${16 + i * 1.6}s linear infinite${i % 2 ? " reverse" : ""}`,
              }}
            />
          ))}
        </g>

        {/* motes rising off the crown */}
        <g transform={bustShift} style={ease} fill={CYAN_SOFT} opacity="0.75">
          {Array.from({ length: 30 }, (_, i) => {
            const a = -Math.PI / 2 + (i / 29 - 0.5) * 1.75;
            const spread = 14 + (i % 5) * 13;
            return (
              <circle
                key={i}
                cx={HEAD.cx + Math.cos(a) * (HEAD.rx * 0.82)}
                cy={HEAD.cy + Math.sin(a) * (HEAD.ry + spread)}
                r={i % 4 === 0 ? 1.7 : 1}
                opacity={0.25 + ((i * 7) % 10) / 14}
                style={{ animation: `imexMote ${2.4 + (i % 7) * 0.42}s ease-in-out ${(i % 9) * 0.21}s infinite alternate` }}
              />
            );
          })}
        </g>

        {/* head + body contour slices — each drifts into place on open */}
        <g transform={bustShift} style={ease} filter="url(#imexGlow)">
          {headLines.map(({ y, w }, i) => (
            <path
              key={`h${i}`}
              d={`M ${HEAD.cx - w} ${y} Q ${HEAD.cx} ${y - 5} ${HEAD.cx + w} ${y}`}
              fill="none"
              stroke="url(#imexEdge)"
              strokeWidth={i % 4 === 0 ? 1.5 : 0.9}
              strokeOpacity={0.42 + (i % 3) * 0.14}
              strokeLinecap="round"
              style={{
                transformOrigin: `${HEAD.cx}px ${y}px`,
                animation: `imexSlice .9s cubic-bezier(.16,.9,.3,1) ${(i % 11) * 0.045}s both`,
              }}
            />
          ))}

          {bodyLines.map(({ y, w }, i) => (
            <path
              key={`b${i}`}
              d={`M ${HEAD.cx - w} ${y} Q ${HEAD.cx} ${y - 11} ${HEAD.cx + w} ${y}`}
              fill="none"
              stroke={CYAN}
              strokeWidth={i % 4 === 0 ? 1.3 : 0.75}
              strokeOpacity={Math.max(0.05, 0.34 - i * 0.006)}
              strokeLinecap="round"
              style={{
                transformOrigin: `${HEAD.cx}px ${y}px`,
                animation: `imexSlice .9s cubic-bezier(.16,.9,.3,1) ${0.12 + (i % 13) * 0.04}s both`,
              }}
            />
          ))}
        </g>

        {/* the lit rim, tracing head into shoulders */}
        <g transform={bustShift} style={ease} fill="none" stroke={CYAN_SOFT} strokeWidth="2.4" strokeOpacity="0.92" strokeLinecap="round" filter="url(#imexGlow)">
          <path d={rimPath.left} />
          <path d={rimPath.right} />
        </g>

        {/* throat channels — warm filaments branching up into the face */}
        <g transform={bustShift} stroke={GOLD} fill="none" strokeLinecap="round"
           opacity={speaking ? 0.95 : 0.5} style={{ transition: "opacity .4s, transform .28s cubic-bezier(.22,.7,.3,1)" }} filter="url(#imexGlow)">
          <path d={`M ${HEAD.cx} 346 C ${HEAD.cx} 400 ${HEAD.cx - 3} 430 ${HEAD.cx} 470`} strokeWidth="2" strokeOpacity="0.85" />
          <path d={`M ${HEAD.cx - 14} 356 C ${HEAD.cx - 22} 398 ${HEAD.cx - 24} 420 ${HEAD.cx - 20} 452`} strokeWidth="1.4" strokeOpacity="0.55" />
          <path d={`M ${HEAD.cx + 14} 356 C ${HEAD.cx + 22} 398 ${HEAD.cx + 24} 420 ${HEAD.cx + 20} 452`} strokeWidth="1.4" strokeOpacity="0.55" />
          <path d={`M ${HEAD.cx - 20} 452 L ${HEAD.cx - 12} 486`} strokeWidth="1.1" strokeOpacity="0.4" />
          <path d={`M ${HEAD.cx + 20} 452 L ${HEAD.cx + 12} 486`} strokeWidth="1.1" strokeOpacity="0.4" />
        </g>

        {/* the face core — leads the turn */}
        <g transform={`${coreShift} ${turn}`} style={{ ...ease, transformOrigin: `${FACE.cx}px ${FACE.cy}px` }}>
          <ellipse
            cx={FACE.cx} cy={FACE.cy} rx={FACE.rx * 1.3} ry={FACE.ry * 1.25}
            fill="url(#imexFaceCore)" opacity={speaking ? 0.62 : 0.4}
            filter="url(#imexCoreGlow)"
            style={{ transition: "opacity .45s ease" }}
          />
          <ellipse cx={FACE.cx} cy={FACE.cy} rx={FACE.rx} ry={FACE.ry} fill="url(#imexFaceCore)" opacity="0.9" />

          {/* the bands that ripple while Imex talks */}
          <g clipPath="url(#imexFaceClip)">
            {faceBands.map(({ y, w, i }) => (
              <path
                key={`f${i}`}
                d={`M ${FACE.cx - w - 8} ${y}
                    q ${(w + 8) / 2} ${-5.5} ${w + 8} 0
                    q ${(w + 8) / 2} ${5.5} ${w + 8} 0`}
                fill="none"
                stroke={i % 3 === 0 ? GOLD_HOT : "#ffd27a"}
                strokeWidth={i % 3 === 0 ? 2 : 1.3}
                strokeOpacity={0.55 + (i % 4) * 0.12}
                strokeLinecap="round"
                style={{
                  transformOrigin: `${FACE.cx}px ${y}px`,
                  animation: `${speaking ? "imexBandTalk" : "imexBandIdle"} ${
                    (speaking ? 0.5 : 2.6) + (i % 5) * (speaking ? 0.07 : 0.22)
                  }s ease-in-out ${(i % 6) * 0.06}s infinite alternate`,
                }}
              />
            ))}
          </g>
        </g>

        </g>

        <text
          x={VB_W - 26} y={392} textAnchor="end"
          fill={CYAN} fillOpacity="0.75" fontSize="11"
          fontFamily="var(--font-mono), monospace" letterSpacing="1.6"
        >
          {statusText}
        </text>

        <style>{`
          @keyframes imexAssemble { from { opacity: 0; transform: scale(1.035) } to { opacity: 1; transform: none } }
          @keyframes imexSlice { from { opacity: 0; transform: scaleX(.24) } to { opacity: 1; transform: none } }
          @keyframes imexHalo { to { transform: rotate(360deg) } }
          @keyframes imexMote { from { opacity: .15; transform: translateY(3px) } to { opacity: .85; transform: translateY(-7px) } }
          @keyframes imexBandIdle { from { transform: scaleX(.97) } to { transform: scaleX(1.03) } }
          @keyframes imexBandTalk { from { transform: scaleX(.82) translateY(1px) } to { transform: scaleX(1.16) translateY(-1px) } }
          @media (prefers-reduced-motion: reduce) {
            circle, path { animation: none !important }
          }
        `}</style>
      </svg>
    </div>
  );
}
