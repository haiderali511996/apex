"use client";

/**
 * The Design agent's output: the camera photo (if any) beside what Gemini
 * made of it, with the instruction it followed and a download.
 */

import { Download, X } from "lucide-react";

export type DesignWork = {
  /** The camera photo the work started from; absent for a picture made from words. */
  photo?: string;
  result?: string;
  instruction?: string;
  note?: string;
  busy: boolean;
};

export default function DesignStudio({ work, onClose }: { work: DesignWork; onClose: () => void }) {
  return (
    <section className="sarah-panel sarah-studio" role="dialog" aria-label="Design studio">
      <header className="sarah-panel-head">
        <span className="sarah-label">Design · Gemini</span>
        <span className="sarah-panel-actions">
          {work.result && (
            <a className="sarah-text-btn" href={work.result} download={`sarah-design-${Date.now()}.jpg`}>
              <Download size={12} /> Download
            </a>
          )}
          <button type="button" className="sarah-icon-btn" onClick={onClose} aria-label="Close the design studio"><X size={14} /></button>
        </span>
      </header>
      <div className={`sarah-studio-frames${work.photo ? "" : " is-single"}`}>
        {work.photo && (
          <figure>
            <img src={work.photo} alt="Your camera photo" />
            <figcaption>Photo</figcaption>
          </figure>
        )}
        <figure className={work.busy ? "is-busy" : ""}>
          {work.result ? <img src={work.result} alt={work.instruction ? `Design: ${work.instruction}` : "Design result"} /> : <div className="sarah-studio-wait" />}
          <figcaption>{work.busy ? "Designing…" : work.result ? "Design" : "Waiting for an instruction"}</figcaption>
        </figure>
      </div>
      {(work.instruction || work.note) && (
        <p className="sarah-studio-note">
          {work.instruction && <span>“{work.instruction}”</span>}
          {work.note && <span className="sarah-muted"> {work.note}</span>}
        </p>
      )}
    </section>
  );
}
