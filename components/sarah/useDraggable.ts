"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lets an agent card be dragged anywhere on the screen by its header, with
 * a mouse or a finger. Until it is moved the card sits where it opened (in
 * the row of working agents, or centred); once moved it floats on its own,
 * comes to the front when touched, and each agent's card reopens where it
 * was last left (remembered on this device). Buttons, links and fields
 * inside the header still work as usual.
 */

type Pos = { x: number; y: number };
const KEY = "sarah.cardPos.";
let topZ = 70;

function load(id: string): Pos | null {
  try { const v = JSON.parse(localStorage.getItem(KEY + id) || "null") as Pos | null; return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null; } catch { return null; }
}
function save(id: string, p: Pos) {
  try { localStorage.setItem(KEY + id, JSON.stringify(p)); } catch { /* storage blocked: still draggable */ }
}

/** Keeps enough of the card on screen to grab it again. */
function clamp(p: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 300;
  return {
    x: Math.min(Math.max(p.x, 80 - w), window.innerWidth - 80),
    y: Math.min(Math.max(p.y, 0), window.innerHeight - 48),
  };
}

export function useDraggable(id: string, initial?: () => Pos) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [z, setZ] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);

  // Where it was left last time, or its starting place.
  useEffect(() => {
    const saved = load(id);
    const start = saved ?? initial?.() ?? null;
    if (start) setPos(clamp(start, ref.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Still reachable after the window shrinks.
  useEffect(() => {
    const onResize = () => setPos(p => (p ? clamp(p, ref.current) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    e.preventDefault();
    setZ(++topZ);
    setDragging(true);
    let last: Pos = { x: r.left, y: r.top };
    setPos(last);
    const move = (ev: PointerEvent) => { last = clamp({ x: ev.clientX - dx, y: ev.clientY - dy }, el); setPos(last); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragging(false);
      save(id, last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [id]);

  /** Brings the card to the front when anything in it is touched. */
  const raise = useCallback(() => setZ(++topZ), []);

  return {
    ref,
    pos,
    /** Spread onto the card: floating at its spot once placed. */
    style: (pos ? { position: "fixed", left: pos.x, top: pos.y, margin: 0, ...(z ? { zIndex: z } : {}) } : z ? { position: "relative", zIndex: z } : {}) as React.CSSProperties,
    onPointerDownCapture: raise,
    /** Spread onto the header: the grip. */
    handle: { onPointerDown, style: { cursor: dragging ? "grabbing" : "grab", touchAction: "none", userSelect: "none" } as React.CSSProperties, title: "Drag to move" },
  };
}
