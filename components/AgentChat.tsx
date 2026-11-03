"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AssistantLogo from "@/components/AssistantLogo";
import { LayoutGrid, MessageSquare, Plug, Volume2, VolumeX } from "lucide-react";
import { useApexVoice } from "@/lib/useApexVoice";
import ConversationPanel from "./sarah/ConversationPanel";
import "./sarah/sarah.css";

const GREETING =
  "Hey — I'm Sarah. Ask me for a report across your accounts, or tell me what to post and I'll draft it for your approval.";

export default function AgentChat() {
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const voice = useApexVoice({ speak: speakEnabled, autoListen: false });

  const { refreshPending } = voice;
  useEffect(() => { refreshPending(); }, [refreshPending]);

  return (
    <div className="sarah-deck is-chat" data-state={voice.state}>
      <div className="sarah-bg" aria-hidden="true" />

      <nav className="sarah-rail" aria-label="Main">
        <Link href="/" className="sarah-mark" aria-label="Sarah home"><AssistantLogo /></Link>
        <Link href="/" className="sarah-rail-btn" title="Deck"><LayoutGrid size={18} /><span>Deck</span></Link>
        <Link href="/agent" className="sarah-rail-btn is-active" aria-current="page" title="Chat"><MessageSquare size={18} /><span>Chat</span></Link>
        <Link href="/connect" className="sarah-rail-btn" title="Connect accounts"><Plug size={18} /><span>Connect</span></Link>
      </nav>

      <header className="sarah-top">
        <div className="sarah-brand">
          <span className="sarah-brand-name">SARAH</span>
          <span className="sarah-brand-sub">Chat</span>
        </div>
      </header>

      <main className="sarah-chat-main">
        <ConversationPanel
          voice={voice}
          greeting={GREETING}
          actions={
            <button
              type="button"
              className={`sarah-icon-btn${speakEnabled ? " is-on" : ""}`}
              onClick={() => setSpeakEnabled((v) => !v)}
              aria-label={speakEnabled ? "Mute spoken replies" : "Speak replies aloud"}
              aria-pressed={speakEnabled}
            >
              {speakEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          }
        />
        {voice.error && <p className="sarah-error sarah-chat-error" role="alert">{voice.error}</p>}
      </main>
    </div>
  );
}
