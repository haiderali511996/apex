"use client";

/**
 * The live camera feed, shown whenever Sarah has it open. It is deliberately
 * visible and labelled — a page holding the camera open should never be
 * ambiguous about it — and it can always be closed from here as well as by
 * voice. Tracked hands are drawn over the picture.
 */

import { useEffect, useRef, useState } from "react";
import { HAND_BONES, readHands, type TrackingStatus } from "@/lib/handTracking";
import { readPhone } from "@/lib/phoneWatch";

const ACCENT = "#00e5ff";
const AMBER = "#f5a623";
const TIPS = [4, 8, 12, 16, 20];

export default function CameraView({
  stream,
  onClose,
  looking,
  tracking = "off",
  docked = false,
}: {
  stream: MediaStream | null;
  onClose: () => void;
  looking: boolean;
  tracking?: TrackingStatus;
  /** Sit in the page's layout instead of floating over it. */
  docked?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [handCount, setHandCount] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  // Draw the tracked hands over the video, mirrored to match it.
  useEffect(() => {
    const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0, shown = -1;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // A phone held up: its outline, and a bar filling until Sarah reads it.
      const phone = readPhone();
      if (phone.box) {
        const bx = (1 - phone.box.x - phone.box.w) * w, by = phone.box.y * h, bw = phone.box.w * w, bh = phone.box.h * h;
        ctx.strokeStyle = AMBER; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(bx, by, bw, bh); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(4,8,15,.7)"; ctx.fillRect(bx, by + bh - 6, bw, 6);
        ctx.fillStyle = AMBER; ctx.fillRect(bx, by + bh - 6, bw * phone.steady, 6);
      }
      const { hands, at } = readHands();
      const live = performance.now() - at < 400 ? hands : [];
      if (live.length !== shown) { shown = live.length; setHandCount(live.length); }
      for (const hand of live) {
        const px = (i: number) => (1 - hand[i].x) * w, py = (i: number) => hand[i].y * h;
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.shadowColor = ACCENT; ctx.shadowBlur = 8;
        ctx.beginPath();
        for (const [a, b] of HAND_BONES) { ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); }
        ctx.stroke();
        ctx.shadowBlur = 0;
        hand.forEach((_, i) => {
          ctx.fillStyle = TIPS.includes(i) ? AMBER : "#e8fdff";
          ctx.beginPath(); ctx.arc(px(i), py(i), TIPS.includes(i) ? 3.5 : 2.2, 0, Math.PI * 2); ctx.fill();
        });
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  const label = looking ? "LOOKING…"
    : tracking === "loading" ? "LOADING HAND TRACKING…"
    : tracking === "tracking" ? (handCount ? `TRACKING ${handCount} HAND${handCount > 1 ? "S" : ""}` : "CAMERA ON · NO HANDS")
    : "CAMERA ON";

  return (
    <div
      style={{
        ...(docked
          ? { position: "relative", width: "100%", flex: "none" }
          : { position: "fixed", bottom: "clamp(16px,3vh,32px)", right: "clamp(16px,3vw,40px)", zIndex: 96, width: "min(300px, 40vw)" }),
        borderRadius: 14, overflow: "hidden",
        border: `1px solid ${ACCENT}66`, background: "rgba(4,8,15,0.9)",
        boxShadow: `0 0 34px ${ACCENT}22, 0 8px 30px rgba(0,0,0,0.6)`,
      }}
    >
      <div style={{ position: "relative" }}>
        <video
          ref={ref}
          muted
          playsInline
          // Mirrored: people expect to see themselves as in a mirror.
          // Natural aspect, uncropped, so the hand overlay lines up with the picture.
          style={{ width: "100%", minHeight: 120, display: "block", transform: "scaleX(-1)", background: "#04080f" }}
        />
        <canvas ref={overlayRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px" }}>
        <span
          style={{
            width: 7, height: 7, borderRadius: "50%", background: "#ff5f56",
            boxShadow: "0 0 8px #ff5f56", flexShrink: 0,
            animation: looking ? "imexRec 1s ease-in-out infinite alternate" : "none",
          }}
        />
        <span aria-live="polite" style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.22em", color: handCount ? ACCENT : "rgba(240,237,232,0.65)" }}>
          {label}
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: 7, padding: "3px 9px", cursor: "pointer",
            fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.18em",
            color: "rgba(240,237,232,0.72)",
          }}
        >
          CLOSE
        </button>
      </div>

      <style>{`@keyframes imexRec { from { opacity: .35 } to { opacity: 1 } }`}</style>
    </div>
  );
}
