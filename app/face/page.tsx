"use client";

import { useRouter } from "next/navigation";
import ImexHologram from "@/components/ImexHologram";
import CameraView from "@/components/CameraView";
import { useApexVoice } from "@/lib/useApexVoice";
import { useCamera } from "@/lib/useCamera";
import { useHandTracking } from "@/lib/handTracking";
import { readCommand, readPhoneMessage } from "@/lib/localCommands";
import { usePhoneWatch } from "@/lib/phoneWatch";

export default function FacePreview() {
  const router = useRouter();
  const camera = useCamera();
  const hands = useHandTracking(camera.videoRef.current, camera.open);
  const voice = useApexVoice({
    onLocalCommand: async text => {
      if (readCommand(text)) return readPhoneMessage(camera);
      if (/\b(hide|close|dismiss)\b.*\b(face|yourself)\b|\b(back|return)\b.*\b(graph|home)\b/i.test(text)) {
        router.push("/");
        return "Back to the graph.";
      }
      return null;
    },
  });
  usePhoneWatch(camera.videoRef.current, camera.open, () => {
    if (voice.state === "thinking" || voice.state === "speaking") return false;
    void voice.send("Read the message on my phone.");
    return true;
  });
  return <>
    <ImexHologram voiceState={voice.state} onClose={() => router.push("/")}
      onMicrophoneToggle={voice.toggle} inputStatus={voice.inputStatus}
      heardText={voice.heardText} caption={voice.spokenSoFar} error={voice.error || camera.error || hands.error}
      cameraOn={camera.open} onCameraToggle={() => (camera.open ? camera.stop() : void camera.start())} />
    {camera.open && <CameraView stream={camera.stream.current} looking={false} tracking={hands.status} onClose={camera.stop} />}
  </>;
}
