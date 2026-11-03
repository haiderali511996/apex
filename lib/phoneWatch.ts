"use client";

/**
 * Notices a phone held up to the camera, on the device (MediaPipe object
 * detection). When one is held close and steady, it fires once, so Sarah can
 * read the message on its screen; it re-arms after the phone is lowered.
 */

import { useEffect, useRef } from "react";
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { visionFiles } from "./handTracking";

const MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
/** How long the phone must be held up before it is read. */
const HOLD_MS = 1200;
/** How long it must be gone before another phone is read. */
const GONE_MS = 2000;
/** Brief misses this short don't count as the phone being lowered. */
const FLICKER_MS = 600;
/** Share of the frame the phone must fill: held up, not lying on a desk behind. */
const MIN_AREA = 0.03;
const INTERVAL_MS = 250;

/** Box normalized to the raw (unmirrored) frame; `steady` runs 0..1 towards a read. */
export type PhoneSighting = { box: { x: number; y: number; w: number; h: number } | null; steady: number };
let latest: PhoneSighting = { box: null, steady: 0 };
export function readPhone(): PhoneSighting { return latest; }

let detector: Promise<ObjectDetector> | null = null;
function loadDetector() {
  detector ??= (async () => {
    const { ObjectDetector } = await import("@mediapipe/tasks-vision");
    const files = await visionFiles();
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO" as const,
      categoryAllowlist: ["cell phone"],
      scoreThreshold: 0.4,
      maxResults: 1,
    });
    return ObjectDetector.createFromOptions(files, options("GPU"))
      .catch(() => ObjectDetector.createFromOptions(files, options("CPU")));
  })();
  detector.catch(() => { detector = null; });
  return detector;
}

/**
 * Watches `video` while `enabled`. `onSteadyPhone` returns whether it acted;
 * if it couldn't (Sarah was busy), the watch keeps waiting instead of re-arming.
 */
export function usePhoneWatch(video: HTMLVideoElement | null, enabled: boolean, onSteadyPhone: () => boolean) {
  const callback = useRef(onSteadyPhone);
  callback.current = onSteadyPhone;

  useEffect(() => {
    if (!enabled || !video) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    let since = 0, lastSeen = -Infinity, armed = true;

    loadDetector().then((found) => {
      const tick = () => {
        if (stopped) return;
        timer = setTimeout(tick, INTERVAL_MS);
        if (video.readyState < 2 || !video.videoWidth) return;
        const now = performance.now();
        let box: PhoneSighting["box"] = null;
        try {
          const b = found.detectForVideo(video, now).detections[0]?.boundingBox;
          if (b) box = { x: b.originX / video.videoWidth, y: b.originY / video.videoHeight, w: b.width / video.videoWidth, h: b.height / video.videoHeight };
        } catch {
          // a dropped frame
        }
        if (box && box.w * box.h >= MIN_AREA) {
          lastSeen = now;
          since ||= now;
        } else {
          box = now - lastSeen < FLICKER_MS ? latest.box : null;
          if (!box) since = 0;
        }
        if (!armed && now - lastSeen > GONE_MS) armed = true;
        const steady = armed && since ? Math.min(1, (now - since) / HOLD_MS) : 0;
        latest = { box, steady };
        if (steady >= 1) {
          since = 0;
          if (callback.current()) armed = false;
        }
      };
      tick();
    }).catch(() => {
      // Watching for a phone is a convenience; "read this message" still works.
    });

    return () => { stopped = true; clearTimeout(timer); latest = { box: null, steady: 0 }; };
  }, [video, enabled]);
}
