"use client";

/**
 * The Sarah deck: the home screen. Today and the agent roster on the left,
 * the core in the middle with a live readout and the control dock, and the
 * conversation on the right. On narrow screens the side panels collapse into
 * tabs under the core.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import AssistantLogo from "@/components/AssistantLogo";
import { AudioLines, Camera, CameraOff, LayoutGrid, MessageSquare, Mic, MicOff, Plug, ScanFace, Square, UserRound } from "lucide-react";
import { pickVoice, useApexVoice, type VoiceState } from "@/lib/useApexVoice";
import { useCamera } from "@/lib/useCamera";
import { useHandTracking } from "@/lib/handTracking";
import { cameraCommand, closeAgentCommand, designEditCommand, designerCommand, faceCommand, photoCommand, readCommand, readPhoneMessage } from "@/lib/localCommands";
import { usePhoneWatch } from "@/lib/phoneWatch";
import SarahCore from "./SarahCore";
import { usePersona } from "@/lib/usePersona";
import TodayCard from "./TodayCard";
import AgentsPanel from "./AgentsPanel";
import ConversationPanel from "./ConversationPanel";
import { AgentOverview, type NodeSel } from "./agents";
import DesignStudio, { type DesignWork } from "./DesignStudio";
import VoicePicker from "../VoicePicker";
import ImexHologram from "../ImexHologram";
import CameraView from "../CameraView";
import "./sarah.css";

const GREETING = "I'm listening. Ask me anything — a report across your accounts, a post to draft, or just how your day looks.";

const STATE_LABEL: Record<VoiceState, string> = {
  idle: "Standby",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const MIC_LABEL = { off: "Mic off", starting: "Connecting", wake: "Wake word", listening: "Mic live" } as const;

type Tab = "chat" | "agents" | "today";

export default function SarahDeck() {
  const { persona } = usePersona();
  const name = persona.name;
  const [selected, setSelected] = useState<NodeSel | null>(null);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [voiceName, setVoiceName] = useState("");
  const camera = useCamera();
  const [looking, setLooking] = useState(false);
  const hands = useHandTracking(camera.videoRef.current, camera.open);
  const toggleCamera = () => (camera.open ? camera.stop() : void camera.start());
  const [design, setDesign] = useState<DesignWork | null>(null);

  /** Takes a sharp photo, opening the camera first if it's closed. */
  const takePhoto = async (): Promise<string | { error: string }> => {
    if (!camera.open && !(await camera.start())) return { error: camera.error ?? "I couldn't open the camera." };
    // 1024px keeps Gemini's edit quick while still sharp on screen.
    return camera.capture(1024, 0.9) ?? { error: "The camera is on, but I couldn't get a picture from it." };
  };

  /** Takes a photo, then has Design work on it — or just shows it and asks, with no instruction. */
  const designFromCamera = async (instruction: string): Promise<string> => {
    const shot = await takePhoto();
    if (typeof shot !== "string") return shot.error;
    if (!instruction) {
      setDesign({ photo: shot, busy: false });
      return "Got the photo. Tell Design what to do with it — like “make it a watercolor painting”.";
    }
    return runDesign(instruction, shot, shot);
  };

  /**
   * The Design agent: Gemini makes a picture from `instruction`, editing
   * `base` when given. `photo` is the original camera shot, kept for the
   * side-by-side. Returns what Sarah says.
   */
  const runDesign = async (instruction: string, base?: string, photo?: string): Promise<string> => {
    setDesign((d) => ({ photo, result: base && base !== photo ? d?.result : undefined, instruction, busy: true }));
    try {
      const res = await fetch("/api/agent/imagine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base, instruction }),
      });
      const data = await res.json();
      if (!res.ok || !data.image) {
        setDesign((d) => d && { ...d, busy: false });
        return data.error || "Design couldn't make that picture.";
      }
      setDesign({ photo, result: data.image, instruction, note: data.note, busy: false });
      return "Here's what Design made. Tell me what to change, or download it.";
    } catch {
      setDesign((d) => d && { ...d, busy: false });
      return "I couldn't reach the server to make that picture.";
    }
  };

  /** Opens the camera if it isn't already, grabs a frame, and looks at it. */
  const lookThroughCamera = async (): Promise<string> => {
    if (!camera.open) {
      const ok = await camera.start();
      if (!ok) return camera.error ?? "I couldn't open the camera.";
    }
    const frame = camera.capture();
    if (!frame) return "The camera is on, but I couldn't get a picture from it.";

    setLooking(true);
    try {
      const res = await fetch("/api/agent/see", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frame }),
      });
      const data = await res.json();
      return data.reply || data.error || "I couldn't make that out.";
    } catch {
      return "I opened the camera but couldn't reach the server to look.";
    } finally {
      setLooking(false);
    }
  };

  const voice = useApexVoice({
    onLocalCommand: async (text) => {
      if (readCommand(text)) {
        setLooking(true);
        try { return await readPhoneMessage(camera); } finally { setLooking(false); }
      }
      // Closing an agent's workspace hides it at once.
      const closeAsk = closeAgentCommand(text);
      if (closeAsk) {
        const devOpen = selected?.key === "developer";
        const closeDesign = design && (closeAsk === "designer" || (closeAsk === "any" && !devOpen));
        const closeDev = devOpen && (closeAsk === "developer" || closeAsk === "any");
        if (closeDesign) { setDesign(null); return "Closed the design studio."; }
        if (closeDev) { setSelected(null); return "Closed the developer."; }
        if (closeAsk === "any" && selected) { setSelected(null); return "Closed."; }
      }
      // Design: a photo to work from, a request addressed to Design, or a
      // follow-up edit while a design is on screen.
      const photoAsk = photoCommand(text);
      if (photoAsk !== null) return designFromCamera(photoAsk);
      const designAsk = designerCommand(text);
      if (designAsk) {
        // "it", "this" or "my photo" means the picture on screen; otherwise start fresh.
        const current = design?.result ?? design?.photo;
        const aboutCurrent = current && /\b(it|this|that|my photo|the photo|the picture|the image)\b/i.test(designAsk);
        return aboutCurrent ? runDesign(designAsk, current, design?.photo) : runDesign(designAsk);
      }
      if (design?.result && /^(?:please )?(?:download|save)\b.*\b(?:it|this|that|picture|image|design|photo)\b/i.test(text.trim())) {
        const link = document.createElement("a");
        link.href = design.result;
        link.download = `sarah-design-${Date.now()}.jpg`;
        link.click();
        return "Saved it to your Downloads folder.";
      }
      const editAsk = design && !design.busy ? designEditCommand(text) : null;
      if (editAsk && design) return runDesign(editAsk, design.result ?? design.photo, design.photo);

      const cam = cameraCommand(text);
      if (cam === "close") {
        camera.stop();
        return "Camera off.";
      }
      if (cam === "open" || cam === "look") return lookThroughCamera();

      const cmd = faceCommand(text);
      if (cmd === "show") {
        setFaceOpen(true);
        return "Here I am, Haider.";
      }
      if (cmd === "hide") {
        setFaceOpen(false);
        return "Back to the deck.";
      }
      return null;
    },
    // Gemini understood a picture request the phrases above missed.
    onClientAction: async (action) => {
      if (action.type !== "design_picture") return null;
      return action.useCamera ? designFromCamera(action.instruction) : runDesign(action.instruction || "a striking picture");
    },
  });

  // Hold a phone up to the open camera and Sarah reads the message on it —
  // unless it is busy, in which case it waits for the next steady hold.
  usePhoneWatch(camera.videoRef.current, camera.open, () => {
    if (voice.state === "thinking" || voice.state === "speaking") return false;
    void voice.send("Read the message on my phone.");
    return true;
  });

  // Anything left awaiting approval from an earlier visit should still be here.
  const { refreshPending } = voice;
  useEffect(() => { refreshPending(); }, [refreshPending]);

  // The browser lists voices late, and the picker can change the choice.
  useEffect(() => {
    const update = () => setVoiceName(pickVoice()?.name ?? "");
    update();
    window.speechSynthesis?.addEventListener?.("voiceschanged", update);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", update);
  }, [voicePickerOpen]);

  const lastReply = [...voice.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const lastAsk = [...voice.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const micOn = voice.inputStatus !== "off";
  const problem = voice.error || camera.error || hands.error;
  // Between turns the mic is closed on purpose (so Sarah can't hear itself); say so.
  const micPaused = !micOn && voice.handsFree && (voice.state === "thinking" || voice.state === "speaking");
  const toggleMic = () => (micOn ? voice.stopListening() : voice.startListening());

  // One line under the core that says what is happening right now.
  const readout =
    voice.state === "listening" ? (voice.heardText ? `“${voice.heardText}”` : "Go ahead — I'm listening.")
    : voice.state === "thinking" ? (lastAsk ? `“${lastAsk}”` : "Working on it…")
    : voice.state === "speaking" ? tail(voice.spokenSoFar, 170)
    : micOn ? "Ready when you are."
    : lastReply ? tail(lastReply, 170) : "Tap the core or turn on the mic to talk.";

  const coreLabel =
    voice.state === "listening" ? `${name} is listening — tap to stop`
    : voice.state === "thinking" ? `${name} is thinking`
    : voice.state === "speaking" ? `${name} is speaking — tap to interrupt`
    : `${name} — tap and speak`;

  return (
    <div className="sarah-deck" data-state={voice.state} data-tab={tab} data-face-workspace={faceOpen && Boolean(design || selected)}>
      <div className="sarah-bg" aria-hidden="true" />

      <nav className="sarah-rail" aria-label="Main">
        <Link href="/" className="sarah-mark" aria-label={`${name} home`}><AssistantLogo /></Link>
        <Link href="/" className="sarah-rail-btn is-active" aria-current="page" title="Deck"><LayoutGrid size={18} /><span>Deck</span></Link>
        <Link href="/agent" className="sarah-rail-btn" title="Chat"><MessageSquare size={18} /><span>Chat</span></Link>
        <Link href="/connections" className="sarah-rail-btn" title="Connections: your keys and accounts"><Plug size={18} /><span>Connect</span></Link>
        <Link href="/account" className="sarah-rail-btn" title="Account: assistant, face, voice and plan"><UserRound size={18} /><span>Account</span></Link>
        <button type="button" className="sarah-rail-btn" onClick={() => setFaceOpen(true)} title="Face"><ScanFace size={18} /><span>Face</span></button>
        <button type="button" className={`sarah-rail-btn${camera.open ? " is-on" : ""}`} onClick={toggleCamera} title="Camera">
          {camera.open ? <Camera size={18} /> : <CameraOff size={18} />}<span>Camera</span>
        </button>
        <button type="button" className={`sarah-rail-btn${voicePickerOpen ? " is-on" : ""}`} onClick={() => setVoicePickerOpen((v) => !v)} aria-expanded={voicePickerOpen} title="Voice">
          <AudioLines size={18} /><span>Voice</span>
        </button>
      </nav>

      <header className="sarah-top">
        <div className="sarah-brand">
          <span className="sarah-brand-name">{name.toUpperCase()}</span>
          <span className="sarah-brand-sub">Personal assistant</span>
        </div>
        <div className="sarah-chips">
          <button type="button" className={`sarah-chip${micOn ? " is-amber" : micPaused ? " is-paused" : ""}`} onClick={toggleMic} aria-pressed={micOn || micPaused}>
            <i className="sarah-dot" />{micPaused ? "Mic paused" : MIC_LABEL[voice.inputStatus]}
          </button>
          {voiceName && <span className="sarah-chip is-quiet"><AudioLines size={12} />{voiceName}</span>}
          <span className="sarah-chip is-cyan"><i className="sarah-dot" />{STATE_LABEL[voice.state]}</span>
        </div>
      </header>

      <aside className="sarah-left">
        <TodayCard />
        <AgentsPanel onOpen={setSelected} active={voice.state === "thinking"} />
      </aside>

      <main className="sarah-stage">
        <div className="sarah-core-wrap">
          <SarahCore state={voice.state} onActivate={voice.toggle} label={coreLabel} />
        </div>
        <div className="sarah-readout" aria-live="polite">
          <div className="sarah-readout-state">{STATE_LABEL[voice.state]}</div>
          <p className="sarah-readout-text">{readout}</p>
          {problem && <p className="sarah-error" role="alert">{problem}</p>}
        </div>
        <div className="sarah-dock" role="toolbar" aria-label="Voice controls">
          <button type="button" className="sarah-dock-btn" onClick={() => setFaceOpen(true)} aria-label={`Show ${name}'s face`}><ScanFace size={18} /></button>
          <button type="button" className={`sarah-dock-btn${camera.open ? " is-on" : ""}`} onClick={toggleCamera} aria-label={camera.open ? "Turn the camera off" : "Turn the camera on"} aria-pressed={camera.open}>
            {camera.open ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
          <button type="button" className={`sarah-mic${micOn ? " is-on" : micPaused ? " is-paused" : ""}`} onClick={toggleMic} aria-pressed={micOn || micPaused} aria-label={micOn || micPaused ? "Turn the microphone off" : "Turn the microphone on"}>
            <span className="sarah-mic-ring" aria-hidden="true" />
            {micOn || micPaused ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
          <button type="button" className="sarah-dock-btn" onClick={voice.stopSpeaking} disabled={voice.state !== "speaking"} aria-label="Stop speaking"><Square size={16} /></button>
          <button type="button" className={`sarah-dock-btn${voicePickerOpen ? " is-on" : ""}`} onClick={() => setVoicePickerOpen((v) => !v)} aria-expanded={voicePickerOpen} aria-label="Choose Sarah's voice"><AudioLines size={18} /></button>
        </div>
        <div className="sarah-tabs" role="tablist" aria-label="Panels">
          {(["chat", "agents", "today"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className="sarah-tab" onClick={() => setTab(t)}>
              {t === "chat" ? "Conversation" : t === "agents" ? "Agents" : "Today"}
            </button>
          ))}
        </div>
      </main>

      <aside className="sarah-right">
        {camera.open && !faceOpen && <CameraView stream={camera.stream.current} looking={looking} tracking={hands.status} onClose={camera.stop} docked />}
        <ConversationPanel voice={voice} greeting={GREETING} />
      </aside>

      {voicePickerOpen && <VoicePicker onClose={() => setVoicePickerOpen(false)} />}
      {design && <DesignStudio work={design} onClose={() => setDesign(null)} />}
      {selected && <AgentOverview sel={selected} onClose={() => setSelected(null)} />}

      {/* The face sits over everything; the voice loop keeps running behind it
          so the conversation continues while it's open. */}
      {faceOpen && <ImexHologram voiceState={voice.state} onClose={() => setFaceOpen(false)} onMicrophoneToggle={voice.toggle}
        workspaceOpen={Boolean(design || selected)}
        inputStatus={voice.inputStatus} heardText={voice.heardText || lastAsk} caption={voice.spokenSoFar || (voice.stillSpeaking ? "" : lastReply)} error={problem}
        cameraOn={camera.open} onCameraToggle={toggleCamera} />}

      {/* Over the face, the camera floats in a corner so the hand you are
          steering with stays in view. */}
      {camera.open && faceOpen && <CameraView stream={camera.stream.current} looking={looking} tracking={hands.status} onClose={camera.stop} />}
    </div>
  );
}

/** The end of a long line, cut at a word, so the readout shows what's current. */
function tail(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  return "…" + cut.slice(cut.indexOf(" ") + 1);
}
