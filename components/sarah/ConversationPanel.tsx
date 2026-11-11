"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ImagePlus, Mic, MicOff, X as XIcon } from "lucide-react";
import type { useApexVoice } from "@/lib/useApexVoice";
import { usePersona } from "@/lib/usePersona";

type Voice = ReturnType<typeof useApexVoice>;

export default function ConversationPanel({ voice, greeting, actions }: {
  voice: Voice;
  greeting: string;
  /** Extra controls for the panel header, e.g. a mute toggle. */
  actions?: React.ReactNode;
}) {
  const name = usePersona().persona.name;
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { attachPhoto } = voice;

  // A screenshot pasted anywhere on the page (⌘V / Ctrl+V) is attached.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      for (const f of files.slice(0, 4)) void attachPhoto(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [attachPhoto]);

  const addFiles = (list: FileList | null | undefined) => {
    for (const f of [...(list ?? [])].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).slice(0, 4)) void attachPhoto(f);
  };
  const listening = voice.state === "listening";
  const lastAssistant = voice.messages.map((m) => m.role).lastIndexOf("assistant");
  const pending = voice.pendingActions.filter((a) => a.status === "pending" || a.status === "approved");

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [voice.messages, voice.pendingActions, voice.heardText, voice.state]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && !voice.attached.length) || voice.state === "thinking" || voice.attaching) return;
    setInput("");
    voice.send(text);
  };

  return (
    <section className="sarah-panel sarah-convo" aria-label="Conversation"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      style={dragging ? { outline: "2px dashed #00e5ff", outlineOffset: -6 } : undefined}>
      <header className="sarah-panel-head">
        <span className="sarah-label">Conversation</span>
        <span className="sarah-panel-actions">
          {actions}
          {voice.messages.length > 0 && (
            <button type="button" className="sarah-text-btn" onClick={() => voice.setMessages([])}>Clear</button>
          )}
        </span>
      </header>

      <div ref={scrollRef} className="sarah-log" aria-live="polite">
        {voice.messages.length === 0 && (
          <div className="sarah-msg is-sarah"><span className="sarah-msg-who">{name}</span><p>{greeting}</p></div>
        )}
        {voice.messages.map((m, i) => {
          const live = m.role === "assistant" && i === lastAssistant && voice.stillSpeaking && voice.state === "speaking";
          return (
            <div key={i} className={`sarah-msg ${m.role === "user" ? "is-you" : "is-sarah"}`}>
              <span className="sarah-msg-who">{m.role === "user" ? "You" : name}</span>
              {m.photos?.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 6px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.photos.map((p) => <img key={p.id} src={p.src} alt="Photo you showed" style={{ width: 120, maxHeight: 120, objectFit: "cover", borderRadius: 8, display: "block" }} />)}
                </div>
              ) : null}
              <p>
                {live ? (<><mark>{voice.spokenSoFar}</mark><span className="sarah-unsaid">{m.content.slice(voice.spokenSoFar.length)}</span></>) : m.content}
              </p>
            </div>
          );
        })}
        {listening && voice.heardText && (
          <div className="sarah-msg is-you is-interim"><span className="sarah-msg-who">You · hearing</span><p>{voice.heardText}</p></div>
        )}
        {voice.state === "thinking" && (
          <div className="sarah-msg is-sarah"><span className="sarah-msg-who">{name}</span><p className="sarah-typing" aria-label="Sarah is thinking"><i /><i /><i /></p></div>
        )}
        {pending.map((action) => (
          <div key={action.id} className="sarah-approval">
            <span className="sarah-label">Needs your approval</span>
            <p>{action.summary}</p>
            {typeof action.payload?.imageUrl === "string" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={action.payload.imageUrl} alt="The picture this post will carry" style={{ width: "100%", maxWidth: 260, borderRadius: 10, marginTop: 8, display: "block" }} />
            )}
            {action.status === "pending" ? (
              <div className="sarah-approval-btns">
                <button type="button" className="sarah-btn is-primary" onClick={() => voice.respondToAction(action.id, true)}><Check size={13} /> Approve</button>
                <button type="button" className="sarah-btn" onClick={() => voice.respondToAction(action.id, false)}><XIcon size={13} /> Reject</button>
              </div>
            ) : <span className="sarah-muted">Working…</span>}
          </div>
        ))}
      </div>

      {(voice.attached.length > 0 || voice.attaching) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "6px 12px 0" }} aria-label="Attached photos">
          {voice.attached.map((p) => (
            <span key={p.id} style={{ position: "relative", display: "inline-block" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt="Attached photo" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, display: "block", border: "1px solid #ffffff22" }} />
              <button type="button" onClick={() => voice.removeAttached(p.id)} aria-label="Remove this photo"
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: "none", background: "#0b1520", color: "#e8eef5", display: "grid", placeItems: "center", cursor: "pointer" }}>
                <XIcon size={12} />
              </button>
            </span>
          ))}
          <span className="sarah-muted" style={{ fontSize: 12 }}>{voice.attaching ? "Uploading…" : `Goes with your next message — say or type what ${name} should do with it.`}</span>
        </div>
      )}
      <form className="sarah-composer" onSubmit={submit}>
        <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <button type="button" className="sarah-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach a photo or screenshot" title="Attach a photo or screenshot (or paste one)">
          <ImagePlus size={15} />
        </button>
        <button
          type="button"
          className={`sarah-icon-btn${voice.inputStatus !== "off" ? " is-on" : ""}`}
          onClick={() => (voice.inputStatus === "off" ? voice.startListening() : voice.stopListening())}
          aria-label={voice.inputStatus === "off" ? "Turn the microphone on" : "Turn the microphone off"}
          aria-pressed={voice.inputStatus !== "off"}
        >
          {voice.inputStatus === "off" ? <MicOff size={15} /> : <Mic size={15} />}
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Type to ${name}…`} aria-label="Message Sarah" />
        <button type="submit" className="sarah-icon-btn is-send" aria-label="Send" disabled={(!input.trim() && !voice.attached.length) || voice.state === "thinking" || voice.attaching}>
          <ArrowUp size={15} />
        </button>
      </form>
    </section>
  );
}
