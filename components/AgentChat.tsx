"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, Check, X as XIcon } from "lucide-react";
import { useApexVoice } from "@/lib/useApexVoice";

const ACCENT = "#00e5ff";

const GREETING =
  "Hey — I'm Imex. Ask me for a report across your accounts, or tell me what to post and I'll draft it for your approval.";

export default function AgentChat() {
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [input, setInput] = useState("");
  const voice = useApexVoice({ speak: speakEnabled });
  const scrollRef = useRef<HTMLDivElement>(null);

  const { refreshPending } = voice;
  useEffect(() => { refreshPending(); }, [refreshPending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [voice.messages, voice.pendingActions]);

  const submit = () => {
    const text = input.trim();
    if (!text || voice.state === "thinking") return;
    setInput("");
    voice.send(text);
  };

  const visiblePending = voice.pendingActions.filter((a) => a.status === "pending" || a.status === "approved");
  const listening = voice.state === "listening";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720, width: "100%", margin: "0 auto", color: "#f0ede8" }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ alignSelf: "flex-start", maxWidth: "82%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "10px 14px", fontSize: 14.5, lineHeight: 1.5 }}>
          {GREETING}
        </div>

        {voice.messages.map((m, i) => (
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

        {voice.state === "thinking" && <div style={{ fontSize: 13, color: "rgba(240,237,232,0.5)" }}>Imex is thinking…</div>}
        {listening && <div style={{ fontSize: 13, color: "#f5a623", letterSpacing: "0.1em" }}>Listening…</div>}
        {voice.error && <div style={{ fontSize: 13, color: "#ffb4a2" }}>{voice.error}</div>}

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
                  onClick={() => voice.respondToAction(action.id, true)}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#04080f", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                >
                  <Check size={13} /> Approve
                </button>
                <button
                  onClick={() => voice.respondToAction(action.id, false)}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}
                >
                  <XIcon size={13} /> Reject
                </button>
              </div>
            ) : (
              <div style={{ opacity: 0.6, fontSize: 12 }}>Working…</div>
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
          onClick={voice.toggle}
          title={listening ? "Stop listening" : "Talk to Imex"}
          style={{ background: listening ? ACCENT : "transparent", border: `1px solid ${listening ? ACCENT : "rgba(255,255,255,0.2)"}`, borderRadius: 10, width: 40, color: listening ? "#04080f" : "#f0ede8", cursor: "pointer" }}
        >
          {listening ? <MicOff size={16} style={{ margin: "auto" }} /> : <Mic size={16} style={{ margin: "auto" }} />}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Ask for a report, or tell me what to post…"
          style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "0 14px", color: "#f0ede8", fontSize: 14 }}
        />
        <button
          onClick={submit}
          disabled={voice.state === "thinking"}
          style={{ background: ACCENT, border: "none", borderRadius: 10, width: 40, color: "#04080f", cursor: "pointer", opacity: voice.state === "thinking" ? 0.5 : 1 }}
        >
          <Send size={16} style={{ margin: "auto" }} />
        </button>
      </div>
    </div>
  );
}
