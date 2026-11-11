"use client";

/**
 * Hand tracking on the open camera, in the browser (MediaPipe). Video never
 * leaves the machine; only the model and its runtime are downloaded, once.
 *
 * Like speechMotion, the latest result lives in a module-level store that
 * animation loops read every frame, so tracking at camera rate never
 * re-renders React.
 */

import { useEffect, useState } from "react";
import type { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

type VisionFiles = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Must match the installed @mediapipe/tasks-vision version. */
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** Normalized to the raw (unmirrored) camera frame: 0..1 across and down. */
export type HandPoint = { x: number; y: number; z: number };
export type HandFrame = { hands: HandPoint[][]; at: number };

/** Bones between the 21 landmarks: wrist, then thumb → pinky. */
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const EMPTY: HandFrame = { hands: [], at: 0 };
let latest: HandFrame = EMPTY;
export function readHands(): HandFrame { return latest; }

/**
 * Where the first tracked hand is, as the person sees it in the mirrored
 * preview: x and y from -1 (left/top) to 1 (right/bottom). Null when no hand
 * has been seen recently.
 */
export function handPointer(maxAgeMs = 400): { x: number; y: number } | null {
  const hand = latest.hands[0];
  if (!hand || performance.now() - latest.at > maxAgeMs) return null;
  const palm = hand[9]; // base of the middle finger: steadier than a fingertip
  return { x: (1 - palm.x) * 2 - 1, y: palm.y * 2 - 1 };
}

let files: Promise<VisionFiles> | null = null;
/** The MediaPipe runtime, loaded once and shared by every vision task. */
export function visionFiles() {
  files ??= import("@mediapipe/tasks-vision").then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(WASM));
  files.catch(() => { files = null; });
  return files;
}

let landmarker: Promise<HandLandmarker> | null = null;
function loadLandmarker() {
  landmarker ??= (async () => {
    const { HandLandmarker } = await import("@mediapipe/tasks-vision");
    const files = await visionFiles();
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO" as const,
      numHands: 2,
    });
    // The GPU path is much faster but not every machine offers it.
    return HandLandmarker.createFromOptions(files, options("GPU"))
      .catch(() => HandLandmarker.createFromOptions(files, options("CPU")));
  })();
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}

export type TrackingStatus = "off" | "loading" | "tracking" | "error";

/** Tracks hands on `video` while `enabled`; clears the store when it stops. */
export function useHandTracking(video: HTMLVideoElement | null, enabled: boolean) {
  const [status, setStatus] = useState<TrackingStatus>("off");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !video) { setStatus("off"); return; }
    let stopped = false, frame = 0, lastTime = -1;
    setStatus("loading"); setError(null);

    loadLandmarker().then((tracker) => {
      if (stopped) return;
      setStatus("tracking");
      const tick = () => {
        if (stopped) return;
        frame = requestAnimationFrame(tick);
        // Only new frames are worth a detection pass.
        if (video.readyState < 2 || video.currentTime === lastTime) return;
        lastTime = video.currentTime;
        try {
          const result = tracker.detectForVideo(video, performance.now());
          latest = { hands: result.landmarks.map((h) => h.map(({ x, y, z }) => ({ x, y, z }))), at: performance.now() };
        } catch {
          // A dropped frame is not worth stopping for.
        }
      };
      tick();
    }).catch((err) => {
      if (stopped) return;
      setStatus("error");
      setError(`Hand tracking couldn't start: ${err instanceof Error ? err.message : String(err)}`);
    });

    return () => { stopped = true; cancelAnimationFrame(frame); latest = EMPTY; };
  }, [video, enabled]);

  return { status, error };
}
