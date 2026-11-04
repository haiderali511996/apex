"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Mic, MicOff, X as XIcon } from "lucide-react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
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
    if (!text || voice.state === "thinking") return;
    setInput("");
    voice.send(text);
  };

  return (
    <section className="sarah-panel sarah-convo" aria-label="Conversation">
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

      <form className="sarah-composer" onSubmit={submit}>
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
        <button type="submit" className="sarah-icon-btn is-send" aria-label="Send" disabled={!input.trim() || voice.state === "thinking"}>
          <ArrowUp size={15} />
        </button>
      </form>
    </section>
  );
}
