"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ParticleAssembly from "./hologram/ParticleAssembly";
import TalkingMouth from "./hologram/TalkingMouth";
import LiveEnergy from "./hologram/LiveEnergy";
import type { VoiceState } from "@/lib/useApexVoice";
import type { InputStatus } from "@/lib/voiceRecognition";

const ART = "/hologram/imex-stages-v3.png";

type Props = {
  voiceState: VoiceState;
  onClose: () => void;
  onMicrophoneToggle: () => void;
  inputStatus: InputStatus;
  heardText?: string;
  caption?: string;
  error?: string | null;
};

/** Nova's live presence, sharing the active conversation and microphone. */
export default function ImexHologram({ voiceState, onClose, onMicrophoneToggle, inputStatus, heardText = "", caption = "", error }: Props) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(1.18);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const assemblyClock = useRef(0);
  const artworkRef = useRef<HTMLImageElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
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
  }, []);

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
    : inputStatus === "wake" ? 'Say “Hey Nova”' : "Microphone off";

  return (
    <div ref={dialogRef} tabIndex={-1} className={`nova-face ${reduced ? "reduced" : ""}`} role="dialog" aria-modal="true" aria-label="Nova holographic presence">
      <header className="face-header">
        <span>NOVA <span className="dim">/ PRESENCE</span></span>
        <button type="button" onClick={onMicrophoneToggle} disabled={voiceState === "thinking"}
          aria-label={micActive ? "Stop microphone" : voiceState === "speaking" ? "Interrupt Nova and speak" : "Talk to Nova"}
          aria-pressed={micActive} className={micActive ? "listening" : ""}>
          <span aria-hidden="true">●</span> {inputStatus === "starting" ? "CANCEL MIC" : listening ? "MIC ON" : "TALK TO NOVA"}
        </button>
      </header>
      <div className="portrait" style={{ width: `min(96vw, ${82 * ratio}vh)`, aspectRatio: ratio }} role="img" aria-label="Nova human hologram">
        {ready && artworkRef.current && <ParticleAssembly image={artworkRef.current} playing={playing} replay={0} reduced={reduced} clock={assemblyClock} onStage={showStage} onComplete={complete} />}
        {ready && artworkRef.current && <TalkingMouth image={artworkRef.current} clock={assemblyClock} reduced={reduced} />}
        {ready && <LiveEnergy stage={step} voiceState={voiceState} reduced={reduced} clock={assemblyClock} />}
        {!ready && <p className="loading">{failed ? "The portrait could not load. Please refresh." : "Preparing presence…"}</p>}
      </div>
      <footer className="conversation">
        <div className="status" role="status"><span className="light" />{status}</div>
        {error ? <p className="voice-error" role="alert">{error}</p>
          : <p className="caption">{voiceState === "speaking" ? caption : heardText}</p>}
      </footer>
      <style jsx>{`
        .nova-face { position: fixed; inset: 0; z-index: 90; overflow: hidden; outline: none; background: #020d18; color: #88d9e2; font-family: var(--font-mono), monospace; }
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
        .voice-error { color: #ffb4a2; }
      `}</style>
    </div>
  );
}
