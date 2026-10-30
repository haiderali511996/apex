"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingAction } from "./agent/types";
import { speakText, cancelSpeech, speechAvailable } from "./speech";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type ChatMessage = { role: "user" | "assistant"; content: string };

import { getRecognitionCtor, VoiceRecognition, type InputStatus } from "./voiceRecognition";

export function speechSupported(): boolean {
  return Boolean(getRecognitionCtor());
}

/** Where the chosen voice is remembered between visits. */
export const VOICE_STORAGE_KEY = "apex.voice";

/**
 * Fallback order when nothing has been chosen yet. The browser's own default
 * is usually the flattest voice installed, so name the good ones first:
 * Daniel and Serena are macOS British, the Google ones are Chrome's.
 */
const VOICE_PREFERENCES = [
  "Google UK English Male",
  "Daniel",
  "Serena",
  "Google UK English Female",
  "Google US English",
  "Samantha",
];

/** English voices only — the roster runs to ~200 entries across every language. */
export function englishVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
}

export function savedVoiceName(): string | null {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveVoiceName(name: string) {
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, name);
  } catch {
    // private mode — the choice just won't persist
  }
}

export function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // What the user picked wins, then a build-time pin, then the preference list.
  const chosen = savedVoiceName() || process.env.NEXT_PUBLIC_APEX_VOICE?.trim();
  if (chosen) {
    const exact = voices.find((v) => v.name === chosen);
    if (exact) return exact;
  }
  for (const name of VOICE_PREFERENCES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }
  // Anything English and local beats the remote default.
  return voices.find((v) => v.lang?.startsWith("en") && v.localService) ?? voices.find((v) => v.lang?.startsWith("en")) ?? null;
}

/**
 * The single voice + chat loop shared by the orb and the chat panel, so both
 * drive the same conversation rather than keeping two rival copies of it.
 */
export function useApexVoice(options: {
  speak?: boolean;
  /**
   * Handles commands about the interface itself ("show your face"). Return the
   * line to say back and the request never reaches the agent — the screen
   * changes immediately rather than after a round trip.
   */
  onLocalCommand?: (text: string) => string | null | Promise<string | null>;
} = {}) {
  const speakEnabled = options.speak ?? true;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<VoiceState>("idle");
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The reply being spoken, and how much of it has been voiced so far.
  const [spokenText, setSpokenText] = useState("");
  const [spokenChars, setSpokenChars] = useState(0);

  const mountedRef = useRef(true);
  const inputRef = useRef<VoiceRecognition | null>(null);
  const [inputStatus, setInputStatus] = useState<InputStatus>("off");
  const [heardText, setHeardText] = useState("");
  const speechGenerationRef = useRef(0);
  const sendRef = useRef<(text: string) => void>(() => {});
  const stateRef = useRef<VoiceState>("idle");
  const setVoiceState = useCallback((value: VoiceState) => {
    stateRef.current = value;
    setState(value);
  }, []);
  // The send loop reads history through a ref so a reply can't race a stale copy.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // Read through a ref so a new handler doesn't rebuild the whole send loop.
  const localCommandRef = useRef(options.onLocalCommand);
  localCommandRef.current = options.onLocalCommand;

  /**
   * The reply is revealed in step with the voice rather than dumped at once.
   * Word-boundary events are the accurate signal, but they don't fire in every
   * browser, so a paced timer runs underneath and boundaries pull the reveal
   * forward whenever they arrive — the text keeps flowing either way.
   */
  const CHARS_PER_SEC = 13; // ≈150 wpm, the default synthesis rate
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedRef = useRef(0);

  const stopReveal = useCallback(() => {
    if (revealTimer.current) clearInterval(revealTimer.current);
    revealTimer.current = null;
  }, []);

  const setRevealed = useCallback((n: number) => {
    revealedRef.current = n;
    setSpokenChars(n);
  }, []);

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      inputRef.current?.setMode(null);
      const generation = ++speechGenerationRef.current;
      stopReveal();
      setSpokenText(text);

      let finished = false;
      const finish = () => {
        if (finished || generation !== speechGenerationRef.current) return;
        finished = true;
        stopReveal();
        setRevealed(text.length);
        onDone?.();
      };

      if (!speakEnabled || !speechAvailable()) {
        finish();
        return;
      }

      setRevealed(0);

      // Captions begin with actual playback, never while TTS is loading.
      speakText(text, pickVoice(), {
        onStart: (hasAlignment) => {
          if (generation !== speechGenerationRef.current || hasAlignment) return;
          const tick = 60;
          revealTimer.current = setInterval(() => {
            const next = Math.min(revealedRef.current + (CHARS_PER_SEC * tick) / 1000, text.length);
            setRevealed(next);
            if (next >= text.length) stopReveal();
          }, tick);
        },
        onWarning: reason => {
          if (generation === speechGenerationRef.current) setError(reason);
        },
        onBoundary: (charIndex, charLength) => {
          if (generation !== speechGenerationRef.current) return;
          const end = charIndex + charLength;
          if (end > revealedRef.current) setRevealed(Math.min(end, text.length));
        },
        onEnd: finish,
        // Speech is a nicety; the text must survive any failure in it.
        onError: (reason) => {
          if (generation !== speechGenerationRef.current) return;
          finish();
          if (reason === "silent") {
            setError("No audio came out — check the tab isn't muted and your volume is up. The reply is above.");
          } else if (reason && reason !== "interrupted" && reason !== "canceled") {
            // A specific cause — a rejected key, a blocked autoplay — is worth
            // saying out loud instead of hiding behind a generic message.
            setError(`${reason} The reply is above.`);
          }
        },
      });
    },
    [speakEnabled, stopReveal, setRevealed]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || stateRef.current === "thinking") return;
      speechGenerationRef.current++;
      cancelSpeech();
      stopReveal();
      inputRef.current?.setMode(null);
      setVoiceState("thinking");
      setHeardText(trimmed);
      const next = [...messagesRef.current, { role: "user" as const, content: trimmed }];
      messagesRef.current = next;
      setMessages(next);
      setError(null);

      // Interface commands are answered here, not by the agent. They may be
      // async — opening the camera and looking through it takes a moment.
      let localReply: string | null | undefined;
      try {
        localReply = await localCommandRef.current?.(trimmed);
      } catch (err) {
        localReply = err instanceof Error ? err.message : "That didn't work.";
      }
      if (!mountedRef.current) return;
      if (localReply) {
        setMessages((m) => [...m, { role: "assistant", content: localReply }]);
        setVoiceState("speaking");
        speak(localReply, () => {
          setVoiceState("idle");
        });
        return;
      }

      setVoiceState("thinking");

      // Only the request itself is guarded here. Rendering and speaking the
      // reply must not be able to masquerade as a network failure.
      let data: { reply?: string; error?: string; pendingActions?: PendingAction[] };
      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        });
        data = await res.json();
      } catch {
        if (!mountedRef.current) return;
        const message = "I couldn't reach the server. Is it running?";
        setMessages((m) => [...m, { role: "assistant", content: message }]);
        setError(message);
        setVoiceState("idle");
        return;
      }

      if (!mountedRef.current) return;
      const reply: string = data.reply || data.error || "Something went wrong.";
      if (data.error) setError(data.error);

      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (Array.isArray(data.pendingActions) && data.pendingActions.length) {
        setPendingActions((prev) => [...(data.pendingActions ?? []), ...prev]);
      }

      setVoiceState("speaking");
      speak(reply, () => {
        setVoiceState("idle");
      });
    },
    [speak, setVoiceState, stopReveal]
  );

  sendRef.current = send;

  const stopListening = useCallback(() => {
    inputRef.current?.setMode(null);
    if (stateRef.current === "listening") setVoiceState("idle");
  }, [setVoiceState]);

  const startListening = useCallback(() => {
    if (!inputRef.current) {
      setError("Voice input isn't supported in this browser. Use Chrome or type in the chat.");
      return;
    }
    // Invalidate speech completion before canceling so it cannot reopen the mic.
    speechGenerationRef.current++;
    cancelSpeech(); stopReveal();
    setError(null); setHeardText("");
    setVoiceState("listening");
    inputRef.current.setMode("command");
  }, [setVoiceState, stopReveal]);

  const stopSpeaking = useCallback(() => {
    speechGenerationRef.current++;
    cancelSpeech(); stopReveal();
    if (stateRef.current === "speaking") setVoiceState("idle");
  }, [stopReveal, setVoiceState]);

  const toggle = useCallback(() => {
    if (stateRef.current === "listening") { stopListening(); return; }
    if (stateRef.current === "thinking") return;
    startListening();
  }, [startListening, stopListening]);

  const refreshPending = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/confirm");
      const data = await res.json();
      if (Array.isArray(data.pendingActions)) setPendingActions(data.pendingActions);
    } catch {
      // best-effort; newly proposed actions still arrive with the chat reply
    }
  }, []);

  const respondToAction = useCallback(
    async (id: string, approve: boolean) => {
      setPendingActions((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: approve ? "approved" : "rejected" } : a))
      );
      try {
        const res = await fetch("/api/agent/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, approve }),
        });
        const data = await res.json();
        const action: PendingAction | undefined = data.action;
        if (!action) return;

        setPendingActions((prev) => prev.map((a) => (a.id === id ? action : a)));
        const summary =
          action.status === "executed"
            ? `Done — ${action.result}`
            : action.status === "failed"
            ? `That failed: ${action.result}`
            : "Okay, I won't do that.";
        setMessages((m) => [...m, { role: "assistant", content: summary }]);
        setVoiceState("speaking");
        speak(summary, () => setVoiceState("idle"));
      } catch {
        setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the server to confirm that." }]);
      }
    },
    [speak]
  );

  // Chrome populates getVoices() asynchronously and returns an empty list on
  // the first call, so warm it up before the first reply needs a voice.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
  }, []);

  // The recognizer starts only through an explicit microphone button press.
  useEffect(() => {
    mountedRef.current = true;
    const Ctor = getRecognitionCtor();
    if (Ctor) inputRef.current = new VoiceRecognition(Ctor, {
      status: status => {
        setInputStatus(status);
        if (status === "off" && stateRef.current === "listening") setVoiceState("idle");
        if (status === "listening" && stateRef.current === "idle") setVoiceState("listening");
      },
      interim: setHeardText,
      transcript: text => { void sendRef.current(text); },
      error: message => {
        setError(message); setVoiceState("idle");
      },
    });
    return () => {
      mountedRef.current = false;
      speechGenerationRef.current++;
      inputRef.current?.dispose(); inputRef.current = null;
      stopReveal(); cancelSpeech();
    };
  }, [stopReveal, setVoiceState]);

  return {
    messages,
    setMessages,
    state,
    error,
    pendingActions,
    send,
    toggle,
    startListening,
    stopListening,
    refreshPending,
    respondToAction,
    inputStatus,
    heardText,
    stopSpeaking,
    /** How far the voice has got through the reply, in characters. */
    spokenChars: Math.floor(spokenChars),
    /** The reply as far as it has been spoken — grows in step with the voice. */
    spokenSoFar: spokenText.slice(0, Math.floor(spokenChars)),
    /** True while there is still more of the reply left to voice. */
    stillSpeaking: spokenChars < spokenText.length,
    supported: speechSupported(),
  };
}
