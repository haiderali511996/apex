"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, Check, X as XIcon } from "lucide-react";
import type { PendingAction } from "@/lib/agent/types";

const ACCENT = "#00e5ff";

type ChatMessage = { role: "user" | "assistant"; content: string };

// Minimal shape of the non-standard Web Speech API — no official TS lib types ship for it.
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: { transcript: string }[][] } & { resultIndex?: number }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export default function AgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hey — I'm Apex. Ask me for a report across your accounts, or tell me what to post and I'll draft it for your approval." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingActions]);

  useEffect(() => {
    refreshPending();
  }, []);

  async function refreshPending() {
    try {
      const res = await fetch("/api/agent/confirm");
      const data = await res.json();
      if (Array.isArray(data.pendingActions)) setPendingActions(data.pendingActions);
    } catch {
      // best-effort; the chat flow still surfaces newly proposed actions
    }
  }

  function speak(text: string) {
    if (!speakEnabled || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utter);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const next = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      const reply = data.reply || data.error || "Something went wrong.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      speak(reply);
      if (Array.isArray(data.pendingActions) && data.pendingActions.length) {
        setPendingActions((prev) => [...data.pendingActions, ...prev]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "I couldn't reach the server. Is it running?" }]);
    } finally {
      setLoading(false);
    }
  }

  function toggleListening() {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setMessages((m) => [...m, { role: "assistant", content: "Voice input isn't supported in this browser — try Chrome, or just type." }]);
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e) => {
      const transcript = e.results?.[e.results.length - 1]?.[0]?.transcript;
      if (transcript) send(transcript);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function respondToAction(id: string, approve: boolean) {
    setPendingActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: approve ? "approved" : "rejected" } : a)));
    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, approve }),
      });
      const data = await res.json();
      const action: PendingAction | undefined = data.action;
      if (action) {
        setPendingActions((prev) => prev.map((a) => (a.id === id ? action : a)));
        const summary = action.status === "executed"
          ? `Done — ${action.result}`
          : action.status === "failed"
          ? `That failed: ${action.result}`
          : `Okay, I won't post that.`;
        setMessages((m) => [...m, { role: "assistant", content: summary }]);
        speak(summary);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the server to confirm that action." }]);
    }
  }

  const visiblePending = pendingActions.filter((a) => a.status === "pending" || a.status === "approved");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720, width: "100%", margin: "0 auto", color: "#f0ede8" }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "82%",
              background: m.role === "user" ? `${ACCENT}1f` : "rgba(255,255,255,0.05)",
              border: `1px solid ${m.role === "user" ? ACCENT + "40" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 14,
              padding: "10px 14px",
              fontSize: 14.5,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && <div style={{ fontSize: 13, color: "rgba(240,237,232,0.5)" }}>Apex is thinking…</div>}

        {visiblePending.map((action) => (
          <div
            key={action.id}
            style={{
              alignSelf: "flex-start",
              maxWidth: "90%",
              background: "rgba(0,229,255,0.06)",
              border: `1px solid ${ACCENT}55`,
              borderRadius: 14,
              padding: "12px 14px",
              fontSize: 13.5,
            }}
          >
            <div style={{ marginBottom: 10, opacity: 0.9 }}>{action.summary}</div>
            {action.status === "pending" ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => respondToAction(action.id, true)}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#04080f", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                >
                  <Check size={13} /> Approve &amp; post
                </button>
                <button
                  onClick={() => respondToAction(action.id, false)}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}
                >
                  <XIcon size={13} /> Reject
                </button>
              </div>
            ) : (
              <div style={{ opacity: 0.6, fontSize: 12 }}>Posting…</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, padding: "12px 8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <button
          onClick={() => setSpeakEnabled((v) => !v)}
          title={speakEnabled ? "Mute spoken replies" : "Enable spoken replies"}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, width: 40, color: speakEnabled ? ACCENT : "#f0ede8", cursor: "pointer" }}
        >
          {speakEnabled ? <Volume2 size={16} style={{ margin: "auto" }} /> : <VolumeX size={16} style={{ margin: "auto" }} />}
        </button>
        <button
          onClick={toggleListening}
          title={listening ? "Stop listening" : "Talk to Apex"}
          style={{ background: listening ? ACCENT : "transparent", border: `1px solid ${listening ? ACCENT : "rgba(255,255,255,0.2)"}`, borderRadius: 10, width: 40, color: listening ? "#04080f" : "#f0ede8", cursor: "pointer" }}
        >
          {listening ? <MicOff size={16} style={{ margin: "auto" }} /> : <Mic size={16} style={{ margin: "auto" }} />}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
          placeholder="Ask for a report, or tell me what to post…"
          style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "0 14px", color: "#f0ede8", fontSize: 14 }}
        />
        <button
          onClick={() => send(input)}
          disabled={loading}
          style={{ background: ACCENT, border: "none", borderRadius: 10, width: 40, color: "#04080f", cursor: "pointer", opacity: loading ? 0.5 : 1 }}
        >
          <Send size={16} style={{ margin: "auto" }} />
        </button>
      </div>
    </div>
  );
}
