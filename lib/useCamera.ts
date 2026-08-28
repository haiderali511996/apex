"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The webcam, opened only on an explicit spoken command and closed the same
 * way. The stream is held here rather than in a component so a frame can be
 * grabbed the moment the camera warms up, without waiting on a render.
 */
export function useCamera() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOpen(false);
  }, []);

  /** Opens the camera and resolves once it is actually producing frames. */
  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open a camera.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setOpen(true);

      // The element is created here rather than rendered, so a frame can be
      // captured even before React has painted the preview.
      const video = videoRef.current ?? document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      videoRef.current = video;
      await video.play().catch(() => {});

      // Webcams hand back black frames for the first moments while they
      // expose, so wait for real data before anyone tries to look.
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
        const done = () => resolve();
        video.addEventListener("loadeddata", done, { once: true });
        setTimeout(done, 2500);
      });
      await new Promise((r) => setTimeout(r, 350));
      return true;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow it in your browser's site settings and ask again."
          : name === "NotFoundError"
          ? "No camera found on this machine."
          : "Couldn't open the camera."
      );
      setOpen(false);
      return false;
    }
  }, []);

  /** Grabs the current frame as a JPEG data URL, or null if nothing is live. */
  const capture = useCallback((maxWidth = 720): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // JPEG keeps the payload small enough to post comfortably.
    return canvas.toDataURL("image/jpeg", 0.82);
  }, []);

  return { open, error, start, stop, capture, videoRef, stream: streamRef };
}
