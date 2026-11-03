"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ParticleAssembly from "./hologram/ParticleAssembly";
import TalkingMouth from "./hologram/TalkingMouth";
import LiveEnergy from "./hologram/LiveEnergy";
import type { VoiceState } from "@/lib/useApexVoice";
import type { InputStatus } from "@/lib/voiceRecognition";
import { handPointer } from "@/lib/handTracking";
import { headPose } from "./hologram/headPose";
import { usePersona } from "@/lib/usePersona";
import { FACES } from "@/lib/persona";


type Props = {
  voiceState: VoiceState;
  onClose: () => void;
  onMicrophoneToggle: () => void;
  inputStatus: InputStatus;
  heardText?: string;
  caption?: string;
  error?: string | null;
  cameraOn?: boolean;
  onCameraToggle?: () => void;
  workspaceOpen?: boolean;
};

/** How far the head turns at the edge of the screen, in degrees. */
const MAX_YAW = 22, MAX_PITCH = 18;
const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));
/** Hands move within the middle of the frame, so their reach is scaled up to a full turn. */
const HAND_GAIN = 1.6;

/** Sarah's live presence, sharing the active conversation and microphone. */
export default function ImexHologram({ voiceState, onClose, onMicrophoneToggle, inputStatus, heardText = "", caption = "", error, cameraOn = false, onCameraToggle, workspaceOpen = false }: Props) {
  const { persona } = usePersona();
  const face = FACES[persona.face], ART = face.art, name = persona.name;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(1.18);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const assemblyClock = useRef(0);
  const artworkRef = useRef<HTMLImageElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const portraitRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  // Where the head should look, from -1..1 on each axis; null lets it rest.
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const lastDrag = useRef<{ x: number; y: number } | null>(null);
  const releasedAt = useRef(0);

  useEffect(() => {
    let mounted = true;
    setReady(false);
    setFailed(false);
    const image = new Image();
    image.onload = () => {
      if (!mounted) return;
      setRatio(image.naturalWidth * 2 / (image.naturalHeight * 3));
      artworkRef.current = image; setReady(true);
    };
    image.onerror = () => { if (mounted) setFailed(true); };
    image.src = ART;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    if (media.matches) { setStep(5); setPlaying(false); }
    dialogRef.current?.focus();
    return () => { mounted = false; };
  }, [ART]);

  // Turn the head toward whatever has its attention: a drag, else a tracked
  // hand, else a slow idle sway. Written straight to the style each frame.
  useEffect(() => {
    let frame = 0, last = performance.now(), yaw = 0, pitch = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const tracked = handPointer();
      const hand = tracked && { x: clamp1(tracked.x * HAND_GAIN), y: clamp1(tracked.y * HAND_GAIN) };
      const held = dragRef.current ?? (now - releasedAt.current < 1200 ? lastDrag.current : null);
      const target = held ?? hand ?? (reduced ? { x: 0, y: 0 } : { x: Math.sin(now / 3200) * 0.12, y: Math.sin(now / 4100) * 0.08 });
      const ease = 1 - Math.exp(-dt * (held || hand ? 7 : 2.5));
      yaw += (target.x * MAX_YAW - yaw) * ease;
      pitch += (target.y * MAX_PITCH - pitch) * ease;
      // Only the head turns: the layers warp it, the shoulders stay still.
      headPose.yaw = yaw * Math.PI / 180;
      headPose.pitch = pitch * Math.PI / 180;
      const reticle = reticleRef.current;
      if (reticle) {
        // The marker shows where the hand really is, not the amplified target.
        reticle.style.opacity = tracked ? "1" : "0";
        if (tracked) reticle.style.transform = `translate(${((tracked.x + 1) / 2 * window.innerWidth).toFixed(1)}px, ${((tracked.y + 1) / 2 * window.innerHeight).toFixed(1)}px)`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); headPose.yaw = headPose.pitch = 0; };
  }, [reduced]);

  /** Pointer position relative to the portrait's centre, -1..1. */
  const lookAt = (event: React.PointerEvent) => {
    const rect = portraitRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clamp1((event.clientX - rect.left - rect.width / 2) / (rect.width / 2)), y: clamp1((event.clientY - rect.top - rect.height / 2) / (rect.height / 2)) };
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = lastDrag.current = lookAt(event);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (dragRef.current) dragRef.current = lastDrag.current = lookAt(event);
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    releasedAt.current = performance.now();
  };

  const showStage = useCallback((value: number) => setStep(value), []);
  const complete = useCallback(() => { setStep(5); setPlaying(false); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const listening = inputStatus === "listening";
  const micActive = inputStatus !== "off";
  const status = voiceState === "speaking" ? "Speaking" : voiceState === "thinking" ? "Thinking"
    : listening ? "Listening" : inputStatus === "starting" ? "Connecting microphone"
    : inputStatus === "wake" ? `Say “Hey ${name}”` : "Microphone off";

  return (
    <div ref={dialogRef} tabIndex={-1} className={`sarah-face ${reduced ? "reduced" : ""} ${workspaceOpen ? "workspace-open" : ""}`} role="dialog" aria-modal={!workspaceOpen} aria-label={`${name} holographic presence`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <header className="face-header">
        <span>{name.toUpperCase()} <span className="dim">/ PRESENCE</span></span>
        <span className="face-actions">
        {onCameraToggle && (
          <button type="button" onClick={onCameraToggle} aria-pressed={cameraOn} className={cameraOn ? "listening" : ""}
            aria-label={cameraOn ? "Turn the camera off" : `Turn the camera on so ${name} can follow your hand`}>
            <span aria-hidden="true">●</span> {cameraOn ? "CAMERA ON" : "CAMERA"}
          </button>
        )}
        <button type="button" onClick={onMicrophoneToggle} disabled={voiceState === "thinking"}
          aria-label={micActive ? "Stop microphone" : voiceState === "speaking" ? `Interrupt ${name} and speak` : `Talk to ${name}`}
          aria-pressed={micActive} className={micActive ? "listening" : ""}>
          <span aria-hidden="true">●</span> {inputStatus === "starting" ? "CANCEL MIC" : listening ? "MIC ON" : `TALK TO ${name.toUpperCase()}`}
        </button>
        </span>
      </header>
      <div ref={portraitRef} className="portrait" style={{ width: `min(96vw, ${82 * ratio}vh)`, aspectRatio: ratio }} role="img" aria-label={`${name} hologram — drag to turn the head`}>
        {ready && artworkRef.current && <ParticleAssembly image={artworkRef.current} playing={playing} replay={0} reduced={reduced} clock={assemblyClock} onStage={showStage} onComplete={complete} />}
        {ready && artworkRef.current && <TalkingMouth image={artworkRef.current} clock={assemblyClock} reduced={reduced} mouthY={face.mouthY} />}
        {ready && <LiveEnergy stage={step} voiceState={voiceState} reduced={reduced} clock={assemblyClock} />}
        {!ready && <p className="loading">{failed ? "The portrait could not load. Please refresh." : "Preparing presence…"}</p>}
      </div>
      <div ref={reticleRef} className="reticle" aria-hidden="true" />
      <footer className="conversation">
        <div className="status" role="status"><span className="light" />{status}</div>
        {error ? <p className="voice-error" role="alert">{error}</p>
          : <p className="caption">{voiceState === "speaking" ? caption : heardText}</p>}
      </footer>
      <style jsx>{`
        .sarah-face { position: fixed; inset: 0; z-index: 90; overflow: hidden; outline: none; background: #020d18; color: #88d9e2; font-family: var(--font-mono), monospace; cursor: grab; touch-action: none; user-select: none; }
        .sarah-face:active { cursor: grabbing; }
        .face-actions { display: flex; gap: 10px; }
        .reticle { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; z-index: 9; border-radius: 50%; border: 1.5px solid #f5a623; box-shadow: 0 0 14px #f5a623, inset 0 0 8px rgba(245,166,35,.5); opacity: 0; pointer-events: none; transition: opacity .25s; }
        .face-header { position: absolute; z-index: 3; top: 26px; left: clamp(20px, 4vw, 64px); right: clamp(20px, 4vw, 64px); display: flex; align-items: center; justify-content: space-between; font-size: 10px; letter-spacing: .2em; }
        .dim { color: #376473; }
        button { background: #020d18; color: #87c2cc; border: 1px solid #23414d; border-radius: 20px; padding: 10px 15px; font: inherit; font-size: 9px; letter-spacing: .13em; cursor: pointer; }
        button.listening { color: #9af1f5; border-color: #43b5c6; }
        button span { margin-right: 7px; }
        button:disabled { opacity: .5; cursor: default; }
        button:focus-visible { outline: 1px solid #a9eff7; outline-offset: 4px; }
        .portrait { position: absolute; top: 47%; left: 50%; transform: translate(-50%, -50%); isolation: isolate; }
        .portrait::after { content: ""; position: absolute; inset: -1px; pointer-events: none; z-index: 8; background: linear-gradient(to bottom, #020d18, transparent 8%, transparent 89%, #020d18), linear-gradient(to right, #020d18, transparent 7%, transparent 93%, #020d18); }
        .loading { position: absolute; inset: 0; display: grid; place-content: center; font-size: 11px; letter-spacing: .12em; }
        .conversation { position: absolute; z-index: 10; bottom: 25px; left: 5%; right: 5%; text-align: center; }
        .status { display: flex; align-items: center; justify-content: center; gap: 9px; font-size: 9px; text-transform: uppercase; letter-spacing: .18em; }
        .light { width: 4px; height: 4px; border-radius: 50%; background: #70d9e7; box-shadow: 0 0 8px #32c4e0; }
        .caption, .voice-error { max-width: 680px; margin: 12px auto 0; font-family: system-ui, sans-serif; font-size: 13px; line-height: 1.5; }
        .caption { color: #94bdc9; max-height: 3em; overflow: hidden; }
        .sarah-face.workspace-open { left: auto; width: clamp(260px, 30vw, 400px); border-left: 1px solid #23414d; }
        .workspace-open .portrait { width: 100% !important; max-height: 65dvh; }
        .workspace-open .face-header { top: 20px; left: 14px; right: 14px; flex-wrap: wrap; gap: 14px; }
        .workspace-open .face-actions { flex-wrap: wrap; gap: 6px; }
        .workspace-open .conversation { left: 14px; right: 14px; }
        @media (max-width: 700px) {
          .sarah-face.workspace-open { inset: 0 0 auto; width: 100%; height: 34dvh; border-left: 0; border-bottom: 1px solid #23414d; }
          .workspace-open .portrait { width: auto !important; height: 29dvh; max-height: none; top: 50%; }
          .workspace-open .face-header { top: 10px; font-size: 8px; }
          .workspace-open .face-actions { margin-left: auto; }
          .workspace-open .face-actions button { padding: 7px; font-size: 8px; }
          .workspace-open .conversation { bottom: 6px; }
          .workspace-open .caption, .workspace-open .voice-error { display: none; }
        }
        .voice-error { color: #ffb4a2; }
      `}</style>
    </div>
  );
}
