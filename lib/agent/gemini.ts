import { cred, isOwnerRequest } from "@/lib/credentials";
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
/** A web page Gemini read while answering with Google Search on. */
export type WebSource = { title: string; uri: string };

/**
 * One Gemini turn. `search: true` lets it look things up with Google Search;
 * the pages it used come back as `sources` on the reply.
 */
export async function generateGemini(system: string, contents: GeminiContent[], declarations?: unknown[], opts: { search?: boolean } = {}): Promise<GeminiContent & { sources?: WebSource[] }> {
  const key = cred("GEMINI_API_KEY")?.trim();
  if (!key) throw new GeminiError(isOwnerRequest() ? "Add GEMINI_API_KEY to .env.local using a free-tier key from aistudio.google.com, then restart Sarah." : "Add your Gemini API key on the Connections page (it's free from aistudio.google.com).", 503);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  const request = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] }, contents,
      generationConfig: { maxOutputTokens: 2048 },
      ...(opts.search ? { tools: [{ google_search: {} }] } : declarations?.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
    }),
  });
  // The connection to Google sometimes stalls for 10–20 s (seen with curl too),
  // and Node gives up connecting after 10 s. Three attempts ride out a stall;
  // a slow answer (the 60 s timeout) is not retried.
  let response: Response | undefined;
  for (let attempt = 1; !response; attempt++) {
    try {
      response = await request();
    } catch (err) {
      if ((err as Error)?.name === "TimeoutError") throw new GeminiError("Gemini took too long to answer. Try again.", 504);
      const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.message;
      console.warn(`[gemini] attempt ${attempt} failed to connect: ${cause}`);
      if (attempt >= 3) throw new GeminiError("Couldn't reach Gemini — the internet connection to Google is unstable right now. Say that again.", 502);
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  if (!response.ok) {
    // Do not forward provider bodies, which can include request details.
    const message = response.status === 429 ? "Gemini's free-tier quota is reached. Wait and try again; no paid fallback was used."
      : response.status === 401 || response.status === 403 ? "Gemini rejected the API key. Check its permissions and project in Google AI Studio."
      : response.status === 404 ? `Gemini model ${model} is unavailable. Choose an available free-tier GEMINI_MODEL in Google AI Studio.`
      : `Gemini request failed (HTTP ${response.status}). Check the model and account configuration.`;
    throw new GeminiError(message, response.status);
  }
  const body = await response.json() as { candidates?: { content?: GeminiContent; finishReason?: string; groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] } }[]; promptFeedback?: { blockReason?: string } };
  const candidate = body.candidates?.[0];
  if (!candidate?.content?.parts?.length) throw new GeminiError("Gemini couldn't answer that request. Try rephrasing it.", 502);
  const sources = (candidate.groundingMetadata?.groundingChunks ?? []).flatMap(c => c.web?.uri ? [{ title: c.web.title || c.web.uri, uri: c.web.uri }] : []);
  return sources.length ? { ...candidate.content, sources } : candidate.content;
}
export function geminiText(content: GeminiContent): string {
  return content.parts.filter(p => !p.thought).map(p => p.text || "").join("\n").trim();
}

/** Answers a question from a live Google Search, with its sources listed underneath. */
export async function searchWeb(query: string, instructions = "Answer from current web results. Be concise and factual; give numbers, dates and names where they matter. If results disagree or are thin, say so."): Promise<string> {
  const reply = await generateGemini(`${instructions} Today is ${new Date().toDateString()}.`, [{ role: "user", parts: [{ text: query }] }], undefined, { search: true });
  const sources = (reply.sources ?? []).slice(0, 5);
  return `${geminiText(reply)}${sources.length ? `\n\nSources:\n${sources.map(s => `- ${s.title}: ${s.uri}`).join("\n")}` : ""}`;
}
