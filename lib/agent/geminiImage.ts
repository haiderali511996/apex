import { GeminiError } from "./gemini";
import { cred } from "@/lib/credentials";

/**
 * Edits a photo (or makes a new picture) from an instruction, with Gemini's
 * image model. The photo goes in as an inline image; the model returns a new
 * image, sometimes with a short note.
 */

const DEFAULT_MODEL = "gemini-3.1-flash-image";

export type ImageResult = { image: string; note: string };

export async function generateImage(instruction: string, photo?: { mimeType: string; data: string }): Promise<ImageResult> {
  const key = cred("GEMINI_API_KEY")?.trim();
  if (!key) throw new GeminiError("Add GEMINI_API_KEY to .env.local to make pictures.", 503);
  const model = process.env.IMEX_IMAGE_MODEL?.trim() || DEFAULT_MODEL;

  const parts: unknown[] = [];
  if (photo) parts.push({ inlineData: photo });
  parts.push({ text: photo ? `Edit this photo: ${instruction}. Keep the person recognizable unless asked otherwise.` : instruction });

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message: string = data?.error?.message ?? `HTTP ${response.status}`;
    if (response.status === 429) throw new GeminiError("Gemini's free picture quota is used up for now. Try again later, or add billing to the key for more.", 429);
    throw new GeminiError(`Gemini couldn't make the picture: ${message}`, response.status);
  }

  const out: { inlineData?: { mimeType: string; data: string }; text?: string }[] = data?.candidates?.[0]?.content?.parts ?? [];
  const picture = out.find((p) => p.inlineData?.data);
  const note = out.map((p) => p.text ?? "").join(" ").trim();
  if (!picture?.inlineData) {
    // Usually a safety refusal, which comes back as text or a finish reason.
    const reason = data?.candidates?.[0]?.finishReason;
    throw new GeminiError(note || (reason ? `Gemini didn't make a picture (${reason}). Try rewording the request.` : "Gemini didn't return a picture. Try rewording the request."), 422);
  }
  return { image: `data:${picture.inlineData.mimeType};base64,${picture.inlineData.data}`, note };
}
