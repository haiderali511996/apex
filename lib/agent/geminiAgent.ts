import { generateGemini, geminiText, type GeminiContent, type GeminiPart } from "./gemini";
import { toolDefinitions, executeTool } from "./tools";
import type { PendingAction } from "./types";

export async function runViaGemini(messages: { role: "user" | "assistant"; content: string }[], system: string) {
  const contents: GeminiContent[] = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const pendingActions: PendingAction[] = [];
  const declarations = toolDefinitions.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));
  for (let round = 0; round < 8; round++) {
    const content = await generateGemini(system, contents, declarations);
    const calls = content.parts.flatMap(p => p.functionCall ? [p.functionCall] : []);
    if (!calls.length) return { reply: geminiText(content) || "Could you say that another way?", pendingActions };
    // Preserve complete model parts, including thought signatures for tool turns.
    contents.push(content);
    const results: GeminiPart[] = [];
    for (const call of calls) {
      let result: string;
      try {
        const output = await executeTool(call.name, call.args || {});
        result = output.text;
        if (output.pendingAction) pendingActions.push(output.pendingAction);
      } catch (error) { result = `Error: ${error instanceof Error ? error.message : String(error)}`; }
      results.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result } } });
    }
    contents.push({ role: "user", parts: results });
  }
  return { reply: "I've paused after several tool calls. Let's handle one task at a time.", pendingActions };
}
