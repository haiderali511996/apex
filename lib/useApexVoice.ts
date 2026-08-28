"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingAction } from "./agent/types";

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
 * The single voice + chat loop shared by the orb and the chat panel, so both
 * drive the same conversation rather than keeping two rival copies of it.
 */
export function useApexVoice(options: { speak?: boolean } = {}) {
  const speakEnabled = options.speak ?? true;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<VoiceState>("idle");
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The send loop reads history through a ref so a reply can't race a stale copy.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      if (!speakEnabled || typeof window === "undefined" || !window.speechSynthesis) {
        onDone?.();
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.onend = () => onDone?.();
      utter.onerror = () => onDone?.();
      window.speechSynthesis.speak(utter);
    },
    [speakEnabled]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const next = [...messagesRef.current, { role: "user" as const, content: trimmed }];
      setMessages(next);
      setState("thinking");
      setError(null);

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        });
        const data = await res.json();
        const reply: string = data.reply || data.error || "Something went wrong.";
        if (data.error) setError(data.error);

        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        if (Array.isArray(data.pendingActions) && data.pendingActions.length) {
          setPendingActions((prev) => [...data.pendingActions, ...prev]);
        }

        setState("speaking");
        speak(reply, () => setState("idle"));
      } catch {
        const message = "I couldn't reach the server. Is it running?";
        setMessages((m) => [...m, { role: "assistant", content: message }]);
        setError(message);
        setState("idle");
      }
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
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();

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

  /** One tap: start listening, or stop whatever is currently happening. */
  const toggle = useCallback(() => {
    if (state === "listening") {
      stopListening();
      return;
    }
    if (state === "speaking") {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      setState("idle");
      return;
    }
    if (state === "thinking") return;
    startListening();
  }, [state, startListening, stopListening]);

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

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

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
    supported: speechSupported(),
  };
}
