"use client";

/**
 * Audition and choose the voice Imex speaks with. macOS ships ~200 voices
 * across every language, so this lists the English ones only, plays a sample
 * on demand, and remembers the choice in localStorage.
 */

import { useEffect, useState } from "react";
import { Volume2, Check } from "lucide-react";
import { englishVoices, savedVoiceName, saveVoiceName, pickVoice } from "@/lib/useApexVoice";
import { speakText } from "@/lib/speech";

const ACCENT = "#00e5ff";
const SAMPLE = "Your traffic is up eighteen percent this month. The pricing post is doing the heavy lifting.";

export default function VoicePicker({ onClose }: { onClose: () => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "playing" | "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const load = () => {
      setVoices(englishVoices());
      setSelected(savedVoiceName() ?? pickVoice()?.name ?? null);
    };
    load();
    // Chrome fills the list asynchronously.
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);

  const preview = (voice: SpeechSynthesisVoice) => {
    setStatus({ kind: "playing", text: `Playing ${voice.name}…` });
    speakText(SAMPLE, voice, {
      onStart: () => setStatus({ kind: "playing", text: `Speaking as ${voice.name}…` }),
      onEnd: () => setStatus({ kind: "ok", text: `${voice.name} works.` }),
      onError: (reason) =>
        setStatus({
          kind: "error",
          text:
            reason === "silent"
              ? `${voice.name} produced no audio. Check the tab isn't muted (right-click the tab) and your Mac's output volume, then try another voice.`
              : reason === "not-allowed"
              ? "The browser blocked audio. Click anywhere on the page first, then try again."
              : `${voice.name} failed: ${reason}. Try a different voice.`,
        }),
    });
  };

  const choose = (voice: SpeechSynthesisVoice) => {
    saveVoiceName(voice.name);
    setSelected(voice.name);
    preview(voice);
  };

  return (
    <div
      role="dialog"
      aria-label="Choose Imex's voice"
      style={{
        position: "absolute", top: 190, right: "clamp(16px,3vw,40px)", zIndex: 70,
        width: "min(380px, 88vw)", maxHeight: "min(460px, 66vh)", display: "flex", flexDirection: "column",
        background: "rgba(4,8,15,0.94)", border: `1px solid ${ACCENT}44`, borderRadius: 14,
        boxShadow: `0 0 40px ${ACCENT}18, 0 8px 32px rgba(0,0,0,0.6)`, backdropFilter: "blur(20px)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", padding: "13px 15px", borderBottom: `1px solid ${ACCENT}22` }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.24em", color: ACCENT }}>IMEX VOICE</div>
          <div style={{ fontSize: 10.5, color: "rgba(240,237,232,0.4)", marginTop: 3 }}>
            {voices.length} English voices — tap to hear
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 18, cursor: "pointer", padding: "4px 6px" }}
        >
          ×
        </button>
      </div>

      <div style={{ overflowY: "auto", padding: 8 }}>
        {voices.length === 0 && (
          <div style={{ padding: 14, fontSize: 12.5, color: "rgba(240,237,232,0.5)" }}>
            No voices reported yet — reload the page and reopen this panel.
          </div>
        )}
        {voices.map((voice) => {
          const isSelected = voice.name === selected;
          return (
            <button
              key={`${voice.name}-${voice.lang}`}
              onClick={() => choose(voice)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "9px 11px", marginBottom: 4, textAlign: "left", cursor: "pointer",
                background: isSelected ? `${ACCENT}18` : "transparent",
                border: `1px solid ${isSelected ? ACCENT + "55" : "transparent"}`,
                borderRadius: 9, color: "rgba(240,237,232,0.88)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13 }}>{voice.name}</span>
                <span style={{ fontSize: 10, color: "rgba(240,237,232,0.4)", marginLeft: 7 }}>{voice.lang}</span>
              </span>
              {isSelected ? (
                <Check size={14} style={{ color: ACCENT, flexShrink: 0 }} />
              ) : (
                <Volume2 size={13} style={{ color: "rgba(240,237,232,0.35)", flexShrink: 0 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Proves whether audio works at all, independent of which voice is
          chosen — the browser's default is the most likely one to speak. */}
      <div style={{ padding: "9px 14px", borderTop: `1px solid ${ACCENT}22`, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={() => {
            setStatus({ kind: "playing", text: "Testing the browser's default voice…" });
            speakText("Sound check. If you can hear this, audio is working.", null, {
              onStart: () => setStatus({ kind: "playing", text: "Playing…" }),
              onEnd: () => setStatus({ kind: "ok", text: "Sound works. If a named voice above stays silent, use this default instead." }),
              onError: () =>
                setStatus({
                  kind: "error",
                  text: "No audio at all. The tab may be muted (right-click the tab → Unmute), or your Mac's output volume or output device needs checking.",
                }),
            });
          }}
          style={{
            background: "transparent", border: `1px solid ${ACCENT}55`, borderRadius: 8,
            padding: "6px 12px", fontSize: 11, cursor: "pointer", color: ACCENT,
            fontFamily: "var(--font-mono)", letterSpacing: "0.14em",
          }}
        >
          TEST SOUND
        </button>
        <span style={{ fontSize: 10.5, color: "rgba(240,237,232,0.4)" }}>uses the browser default</span>
      </div>

      {status && (
        <div style={{
          padding: "9px 14px", borderTop: `1px solid ${ACCENT}22`, fontSize: 11, lineHeight: 1.5,
          color: status.kind === "error" ? "#ffb4a2" : status.kind === "ok" ? "#7ee0a5" : ACCENT,
        }}>
          {status.text}
        </div>
      )}

      <div style={{ padding: "10px 14px", borderTop: `1px solid ${ACCENT}22`, fontSize: 10.5, lineHeight: 1.5, color: "rgba(240,237,232,0.45)" }}>
        For markedly better quality, download an Enhanced or Premium voice in
        System Settings → Accessibility → Spoken Content → System Voice → Manage Voices.
      </div>
    </div>
  );
}
