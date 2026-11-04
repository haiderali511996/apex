/**
 * The transcriber answers {"speech", "clear", "text"}. Only real, clearly
 * heard speech is acted on: given music or noise the model otherwise invents
 * a plausible command ("Sarah, play music"), and Sarah would act on words
 * nobody said.
 */
export function acceptTranscript(raw: string): string {
  let parsed: { speech?: unknown; clear?: unknown; text?: unknown };
  try { parsed = JSON.parse(raw); } catch { return ""; }
  if (parsed.speech !== true || parsed.clear === false || typeof parsed.text !== "string") return "";
  return parsed.text.trim();
}
