/** Gemini REST transport. Credentials remain on the server; no paid fallback. */
export const BACKEND = (process.env.IMEX_BACKEND || "gemini").trim().toLowerCase();
export type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: { result: string }; id?: string };
};
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export class GeminiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function generateGemini(system: string, contents: GeminiContent[], declarations?: unknown[]) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiError("Add GEMINI_API_KEY to .env.local using a free-tier key from aistudio.google.com, then restart Nova.", 503);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] }, contents,
      generationConfig: { maxOutputTokens: 2048 },
      ...(declarations?.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
    }),
  });
  if (!response.ok) {
    // Do not forward provider bodies, which can include request details.
    const message = response.status === 429 ? "Gemini's free-tier quota is reached. Wait and try again; no paid fallback was used."
      : response.status === 401 || response.status === 403 ? "Gemini rejected the API key. Check its permissions and project in Google AI Studio."
      : response.status === 404 ? `Gemini model ${model} is unavailable. Choose an available free-tier GEMINI_MODEL in Google AI Studio.`
      : `Gemini request failed (HTTP ${response.status}). Check the model and account configuration.`;
    throw new GeminiError(message, response.status);
  }
  const body = await response.json() as { candidates?: { content?: GeminiContent; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const candidate = body.candidates?.[0];
  if (!candidate?.content?.parts?.length) throw new GeminiError("Gemini couldn't answer that request. Try rephrasing it.", 502);
  return candidate.content;
}
export function geminiText(content: GeminiContent): string {
  return content.parts.filter(p => !p.thought).map(p => p.text || "").join("\n").trim();
}
