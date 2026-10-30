"use client";

import { useRouter } from "next/navigation";
import ImexHologram from "@/components/ImexHologram";
import { useApexVoice } from "@/lib/useApexVoice";

export default function FacePreview() {
  const router = useRouter();
  const voice = useApexVoice({
    onLocalCommand: text => {
      if (/\b(hide|close|dismiss)\b.*\b(face|yourself)\b|\b(back|return)\b.*\b(graph|home)\b/i.test(text)) {
        router.push("/");
        return "Back to the graph.";
      }
      return null;
    },
  });
  return <ImexHologram voiceState={voice.state} onClose={() => router.push("/")}
    onMicrophoneToggle={voice.toggle} inputStatus={voice.inputStatus}
    heardText={voice.heardText} caption={voice.spokenSoFar} error={voice.error} />;
}
