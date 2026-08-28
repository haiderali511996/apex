"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingAction } from "./agent/types";
import { speakText, cancelSpeech, speechAvailable } from "./speech";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type ChatMessage = { role: "user" | "assistant"; content: string };

// Minimal shape of the non-standard Web Speech API — no official TS lib types ship for it.
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

export function speechSupported(): boolean {
  return Boolean(getRecognitionCtor());
}

/**
 * Wake phrases that hand the rest of the sentence straight to the agent, so
 * "Hello Imex, how's my SEO?" is one uninterrupted request rather than a
 * wake-up followed by a second turn. Longest first: "hey imex" must not match
 * before "hello imex" and swallow the wrong prefix.
 *
 * "Imex" isn't a dictionary word, so recognizers routinely hear it as "IMAX",
 * "I max", "eemex" or plain "Apex". Those spellings are accepted too —
 * otherwise the wake word would fail for reasons the user can't see or fix.
 */
const NAMES = ["imex", "imax", "i max", "eemex", "emex", "apex"];
const GREETINGS = ["hello", "hey", "hi", "ok", "okay"];
const WAKE_PHRASES = [
  ...GREETINGS.flatMap((g) => NAMES.map((n) => `${g} ${n}`)),
  ...NAMES,
];

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

/** Returns whatever followed the wake phrase, or null when none was said. */
function matchWake(transcript: string): string | null {
  const normalized = transcript.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  for (const phrase of WAKE_PHRASES) {
    if (normalized === phrase) return "";
    if (normalized.startsWith(phrase + " ")) return transcript.trim().slice(phrase.length).replace(/^[\s,.!?]+/, "");
  }
  return null;
}

/**
 * The single voice + chat loop shared by the orb and the chat panel, so both
 * drive the same conversation rather than keeping two rival copies of it.
 */
export function useApexVoice(options: { speak?: boolean; wakeWord?: boolean } = {}) {
  const speakEnabled = options.speak ?? true;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<VoiceState>("idle");
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wakeWordOn, setWakeWordOn] = useState(false);
  // The reply being spoken, and how much of it has been voiced so far.
  const [spokenText, setSpokenText] = useState("");
  const [spokenChars, setSpokenChars] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRef = useRef<SpeechRecognitionLike | null>(null);
  // Lets the wake listener's restart loop know whether it's still wanted,
  // without re-creating the listener every time it fires.
  const wakeWantedRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");
  stateRef.current = state;
  // The send loop reads history through a ref so a reply can't race a stale copy.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

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
      stopReveal();
      setSpokenText(text);

      const finish = () => {
        stopReveal();
        setRevealed(text.length);
        onDone?.();
      };

      if (!speakEnabled || !speechAvailable()) {
        finish();
        return;
      }

      setRevealed(0);

      // The paced reveal runs regardless, so a silent browser still shows the
      // reply arriving word by word rather than freezing on an empty caption.
      const tick = 60;
      revealTimer.current = setInterval(() => {
        const next = Math.min(revealedRef.current + (CHARS_PER_SEC * tick) / 1000, text.length);
        setRevealed(next);
        if (next >= text.length) stopReveal();
      }, tick);

      speakText(text, pickVoice(), {
        onBoundary: (charIndex, charLength) => {
          const end = charIndex + charLength;
          if (end > revealedRef.current) setRevealed(Math.min(end, text.length));
        },
        onEnd: finish,
        // Speech is a nicety; the text must survive any failure in it.
        onError: (reason) => {
          finish();
          if (reason === "silent") {
            setError("No audio came out — check the tab isn't muted and your volume is up. The reply is above.");
          }
        },
      });
    },
    [speakEnabled, stopReveal, setRevealed]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const next = [...messagesRef.current, { role: "user" as const, content: trimmed }];
      setMessages(next);
      setState("thinking");
      setError(null);

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
        const message = "I couldn't reach the server. Is it running?";
        setMessages((m) => [...m, { role: "assistant", content: message }]);
        setError(message);
        setState("idle");
        return;
      }

      const reply: string = data.reply || data.error || "Something went wrong.";
      if (data.error) setError(data.error);

      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (Array.isArray(data.pendingActions) && data.pendingActions.length) {
        setPendingActions((prev) => [...(data.pendingActions ?? []), ...prev]);
      }

      setState("speaking");
      speak(reply, () => setState("idle"));
    },
    [speak]
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setState((s) => (s === "listening" ? "idle" : s));
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser — try Chrome, or type instead.");
      return;
    }
    cancelSpeech();

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e) => {
      const transcript = e.results?.[e.results.length - 1]?.[0]?.transcript;
      recognitionRef.current = null;
      if (transcript) send(transcript);
      else setState("idle");
    };
    recognition.onerror = (e) => {
      recognitionRef.current = null;
      setError(
        e.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser's site settings, then tap again."
          : e.error === "no-speech"
          ? "I didn't catch anything — tap and try again."
          : "Voice input failed. Check your microphone and try again."
      );
      setState("idle");
    };
    recognition.onend = () => {
      // Only fall back to idle if no transcript moved us on to thinking.
      setState((s) => (s === "listening" ? "idle" : s));
    };

    recognitionRef.current = recognition;
    setError(null);
    setState("listening");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setError("Couldn't start listening — is another tab already using the microphone?");
      setState("idle");
    }
  }, [send]);

  /** Cuts the voice off mid-sentence and settles the caption where it stopped. */
  const stopSpeaking = useCallback(() => {
    cancelSpeech();
    stopReveal();
    setState((s) => (s === "speaking" ? "idle" : s));
  }, [stopReveal]);

  /** One tap: start listening, or stop whatever is currently happening. */
  const toggle = useCallback(() => {
    if (state === "listening") {
      stopListening();
      return;
    }
    if (state === "speaking") {
      cancelSpeech();
      setState("idle");
      return;
    }
    if (state === "thinking") return;
    startListening();
  }, [state, startListening, stopListening]);

  /**
   * Background listener for the wake phrase. It runs its own recognizer in
   * interim mode and restarts itself whenever the browser ends the session
   * (Chrome stops it every ~60s, and on every result), so saying
   * "Hello Apex" works without touching anything.
   */
  const stopWakeWord = useCallback(() => {
    wakeWantedRef.current = false;
    setWakeWordOn(false);
    try { wakeRef.current?.stop(); } catch { /* already stopped */ }
    wakeRef.current = null;
  }, []);

  const startWakeWord = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Wake word needs the Web Speech API — try Chrome.");
      return;
    }
    if (wakeWantedRef.current) return;
    wakeWantedRef.current = true;
    setWakeWordOn(true);

    const spawn = () => {
      if (!wakeWantedRef.current) return;
      // Never run the wake listener while the main recognizer holds the mic,
      // or the two fight over it and Chrome aborts both.
      if (stateRef.current !== "idle") {
        setTimeout(spawn, 700);
        return;
      }

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (e) => {
        const results = e.results as unknown as ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }>;
        for (let i = 0; i < results.length; i++) {
          const transcript = results[i]?.[0]?.transcript ?? "";
          const rest = matchWake(transcript);
          if (rest === null) continue;

          try { recognition.stop(); } catch { /* already stopping */ }
          wakeRef.current = null;
          // With a question attached, send it straight through; a bare
          // "Hello Apex" just opens the mic for what comes next.
          if (rest) send(rest);
          else startListening();
          return;
        }
      };
      recognition.onerror = (e) => {
        // "no-speech"/"aborted" are the normal idle outcomes — keep waiting.
        if (e.error === "not-allowed") {
          wakeWantedRef.current = false;
          setWakeWordOn(false);
          setError("Microphone access was blocked, so the wake word can't listen. Allow it in your browser's site settings.");
        }
      };
      recognition.onend = () => {
        wakeRef.current = null;
        if (wakeWantedRef.current) setTimeout(spawn, 400);
      };

      wakeRef.current = recognition;
      try {
        recognition.start();
      } catch {
        setTimeout(spawn, 800);
      }
    };

    spawn();
    // send/startListening are stable callbacks; spawn re-reads them on each restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, startListening]);

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
        setState("speaking");
        speak(summary, () => setState("idle"));
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

  // Opt in from the caller; the mic only opens once the browser grants it.
  const wantWakeWord = options.wakeWord ?? false;
  useEffect(() => {
    if (!wantWakeWord) return;
    startWakeWord();
    return () => stopWakeWord();
  }, [wantWakeWord, startWakeWord, stopWakeWord]);

  useEffect(() => {
    return () => {
      wakeWantedRef.current = false;
      try { wakeRef.current?.stop(); } catch { /* already stopped */ }
      recognitionRef.current?.stop();
      stopReveal();
      cancelSpeech();
    };
  }, [stopReveal]);

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
    wakeWordOn,
    startWakeWord,
    stopWakeWord,
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
