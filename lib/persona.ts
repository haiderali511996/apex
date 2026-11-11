/**
 * What each user can make their assistant: its name, its face and its voice.
 * Shared by the server (prompts, speech) and the browser (face, labels).
 */

export type Face = "female" | "male";
export type VoiceGender = "female" | "male";

export type Persona = {
  /** What the assistant is called — and the wake word ("Hey <name>"). */
  name: string;
  face: Face;
  voice: VoiceGender;
  /** What the assistant calls the user. */
  userName: string;
};

export const DEFAULT_PERSONA: Persona = { name: "Sarah", face: "female", voice: "female", userName: "" };

/** The portrait for each face, and where its mouth sits (share of the frame's height). */
export const FACES: Record<Face, { art: string; mouthY: number; label: string }> = {
  female: { art: "/hologram/sarah-woman-hair-stages-v2.png?v=hair-1", mouthY: 0.503, label: "Female" },
  male: { art: "/hologram/imex-man-hair-stages-v4.png?v=hair-1", mouthY: 0.515, label: "Male" },
};

/** Names are spoken and used as a wake word: letters and spaces, short. */
export function cleanAssistantName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.trim().replace(/\s+/g, " ");
  return /^[\p{L}][\p{L} '-]{0,23}$/u.test(n) ? n : null;
}

/** The product's own name, separate from what each user calls their assistant. */
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Sarah";

/** Who makes and runs the product. */
export const COMPANY = "UNC Team";
export const ECOSYSTEM = "UNC ecosystem";
