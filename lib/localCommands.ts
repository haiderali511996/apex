// Interface commands Sarah answers itself, before a request reaches the agent.

/** Asking for a picture to be made or changed — Design's work, not a glance through the camera. */
const DESIGN_INTENT = /\b(?:cartoon|anime|painting|watercolou?r|sketch|drawing|illustration|superhero|astronaut|avatar|portrait|style|filter|edit|redesign|design|look like|turn (?:me|it|this|that|him|her) into|make (?:me|it|this|that) (?:look|into|a|an)|as an? )\b/i;

/** Phrases that open, close, or look through the camera. */
export function cameraCommand(text: string): "open" | "close" | "look" | null {
  const t = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  // "Use the webcam and make me a cartoon" is for Design; only closing stays here.
  if (DESIGN_INTENT.test(t) && !/\b(close|stop|turn off|shut)\b/.test(t)) return null;
  if (/\b(close|stop|turn off|shut)\b.*\b(camera|webcam|cam)\b/.test(t)) return "close";
  if (/\b(open|start|turn on|switch on|use)\b.*\b(camera|webcam|cam)\b/.test(t)) return "open";
  if (/\bcan you see me\b|\bdo you see me\b|\blook at me\b|\bwhat do you see\b|\bwho do you see\b/.test(t)) return "look";
  return null;
}

/**
 * "Close the agent", "close the developer card", "close the design studio".
 * Names which workspace to close, or "any" for whichever is on screen.
 */
export function closeAgentCommand(text: string): "designer" | "developer" | "any" | null {
  const t = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (!/\b(close|hide|dismiss|remove|shut)\b/.test(t)) return null;
  if (/\b(camera|webcam|cam|face|yourself)\b/.test(t)) return null;
  if (/\b(designer|design agent|design studio|design card|design window|design)\b/.test(t)) return "designer";
  if (/\b(developer|dev agent|developer agent|developer card)\b/.test(t)) return "developer";
  if (/\b(agent|card|workspace|overview|window|panel)\b/.test(t)) return "any";
  return null;
}

/** Phrases that summon or dismiss the face, matched before the agent sees them. */
export function faceCommand(text: string): "show" | "hide" | null {
  const t = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(hide|close|dismiss)\b.*\b(face|yourself)\b/.test(t)) return "hide";
  if (/\b(show|see|reveal)\b.*\b(your|the|imex)?\s*face\b/.test(t)) return "show";
  if (/\b(what|how)\b.*\byou\b.*\blook\b/.test(t)) return "show";
  if (/\blet me see you\b|\bshow yourself\b/.test(t)) return "show";
  return null;
}

/** Phrases asking Sarah to read a message off the phone held up to the camera. */
export function readCommand(text: string): boolean {
  const t = text.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  // "Read" must open the request, so "Editor, read this and reply" goes to the Editor.
  return /^(?:(?:hey |ok |okay )?sarah )?(?:can you |could you |please )?(?:read|scan)\b.*\b(?:message|messages|screen|phone|mobile)\b/.test(t)
    || /^(?:please )?(?:read|scan) (?:this|it|that)(?: please| for me)?$/.test(t)
    || /\bwhat does (?:it|this|that|the message|my phone|the screen) say\b/.test(t);
}

/** Reads the message on a phone held up to the camera, opening the camera if needed. */
export async function readPhoneMessage(camera: {
  open: boolean;
  error: string | null;
  start: () => Promise<boolean>;
  capture: (maxWidth?: number, quality?: number) => string | null;
}): Promise<string> {
  if (!camera.open) {
    const ok = await camera.start();
    if (!ok) return camera.error ?? "I couldn't open the camera.";
  }
  // Screen text needs a sharper frame than a glance around the room.
  const frame = camera.capture(1280, 0.92);
  if (!frame) return "The camera is on, but I couldn't get a picture from it.";
  try {
    const res = await fetch("/api/agent/see", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: frame, mode: "read" }),
    });
    const data = await res.json();
    return data.reply || data.error || "I couldn't read that.";
  } catch {
    return "I took the picture but couldn't reach the server to read it.";
  }
}

const normalize = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * "Take a picture (of me) and make it a painting" → the instruction, or ""
 * for a plain "take a picture". Null when the request isn't for a photo.
 */
export function photoCommand(text: string): string | null {
  const t = normalize(text);
  // Anywhere in the sentence: "hey Sarah, can you please take my photo and …".
  const en = t.match(/\b(?:take|capture|snap|click|grab|shoot|get)(?: me)? (?:a |an |my |one |another |the |some )?(?:quick |new |nice )?(?:picture|photo|photograph|pic|selfie|snapshot|image|shot)s?\b(?: of (?:me|us|this|that|it|myself))?(?: (?:now|please|right now))?[ ,.]*(?:(?:and|then|to)\b[ ,]*)?(.*)$/i);
  if (en) return en[1].replace(/[.!?]+$/, "").trim();
  // Roman Urdu: "meri photo lo", "tasveer khencho aur isay cartoon bana do".
  const ur = t.match(/\b(?:meri|mera|hamari|ek|aik)? ?(?:photo|picture|pic|tasveer|tasweer|selfie)\b (?:lo|le lo|lein|lijiye|khencho|khenchain|kheencho|khinch|khench do|le|click karo|kheench lo)\b[ ,.]*(?:(?:aur|or|phir)\b[ ,]*)?(.*)$/i);
  return ur ? ur[1].replace(/[.!?]+$/, "").trim() : null;
}

/**
 * Requests addressed to the Design agent: "Designer, make a logo for Chatrix".
 * Returns the instruction, or null when Design isn't being asked.
 */
export function designerCommand(text: string): string | null {
  const t = normalize(text);
  const named = t.match(/^(?:(?:hey |ok |okay )?sarah,? )?(?:ask |tell |have )?(?:the )?(?:designer|design agent|design)\b[ ,:]*(?:to |please )?(.+)$/i);
  if (named) return named[1].replace(/[.!?]+$/, "").trim();
  const make = t.match(/^(?:(?:can|could) you |please )?(?:draw|generate|create|design|make) (?:me )?(?:a|an) (?:new )?(?:picture|image|logo|poster|banner|illustration|drawing|thumbnail|icon|wallpaper|portrait|cartoon|sticker)\b.*$/i);
  return make ? t.replace(/[.!?]+$/, "") : null;
}

/** With a Design result on screen, follow-ups like "make it darker" edit it. */
export function designEditCommand(text: string): string | null {
  const t = normalize(text);
  // Requests about other work go to Sarah as usual, even with a design on screen.
  if (/\b(?:quote|email|mail|post|tweet|report|invoice|project|code|commit|pull|test|meeting|calendar|reply|message)\b/i.test(t)) return null;
  return /^(?:now |and |also |ok |okay )?(?:make|turn|change|edit|add|remove|put|give|convert|transform|replace|swap|try|use|redo|style|zoom|crop|brighten|darken|colou?r)\b/i.test(t)
    ? t.replace(/^(?:now |and |also |ok |okay )/i, "").replace(/[.!?]+$/, "")
    : null;
}
