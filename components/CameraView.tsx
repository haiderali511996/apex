"use client";

/**
 * The live camera feed, shown whenever Imex has it open. It is deliberately
 * visible and labelled — a page holding the camera open should never be
 * ambiguous about it — and it can always be closed from here as well as by
 * voice.
 */

import { useEffect, useRef } from "react";

const ACCENT = "#00e5ff";

export default function CameraView({
  stream,
  onClose,
  looking,
}: {
  stream: MediaStream | null;
  onClose: () => void;
  looking: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  return (
    <div
      style={{
        position: "absolute", bottom: "clamp(16px,3vh,32px)", right: "clamp(16px,3vw,40px)",
        zIndex: 96, width: "min(280px, 26vw)", borderRadius: 14, overflow: "hidden",
        border: `1px solid ${ACCENT}66`, background: "rgba(4,8,15,0.9)",
        boxShadow: `0 0 34px ${ACCENT}22, 0 8px 30px rgba(0,0,0,0.6)`,
      }}
    >
      <video
        ref={ref}
        muted
        playsInline
        // Mirrored: people expect to see themselves as in a mirror.
        style={{ width: "100%", display: "block", transform: "scaleX(-1)", background: "#04080f" }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px" }}>
        <span
          style={{
            width: 7, height: 7, borderRadius: "50%", background: "#ff5f56",
            boxShadow: "0 0 8px #ff5f56", flexShrink: 0,
            animation: looking ? "imexRec 1s ease-in-out infinite alternate" : "none",
          }}
        />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.22em", color: "rgba(240,237,232,0.65)" }}>
          {looking ? "LOOKING…" : "CAMERA ON"}
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
