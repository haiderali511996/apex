import { generateGemini, geminiText, type GeminiContent, type GeminiPart } from "./gemini";
import { toolDefinitions, executeTool } from "./tools";
import type { ClientAction, PendingAction } from "./types";

export type AgentMessage = { role: "user" | "assistant"; content: string; images?: { mimeType: string; data: string }[] };

export async function runViaGemini(messages: AgentMessage[], system: string, opts: { tools?: boolean; exclude?: (name: string) => boolean } = {}) {
  const contents: GeminiContent[] = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [...(m.images ?? []).map(inlineData => ({ inlineData })), { text: m.content }] }));
  const pendingActions: PendingAction[] = [];
  const clientActions: ClientAction[] = [];
  // Without tools the model can only talk: used for accounts that haven't
  // connected anything, so they never reach the owner's connections.
  const declarations = opts.tools === false ? undefined : toolDefinitions.filter(t => !opts.exclude?.(t.name)).map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));
  for (let round = 0; round < 8; round++) {
    const content = await generateGemini(system, contents, declarations);
    const calls = content.parts.flatMap(p => p.functionCall ? [p.functionCall] : []);
    if (!calls.length) return { reply: geminiText(content) || "Could you say that another way?", pendingActions, clientActions };
    // Preserve complete model parts, including thought signatures for tool turns.
    contents.push(content);
    const results: GeminiPart[] = [];
    for (const call of calls) {
      let result: string;
      try {
        // A tool that wasn't offered is refused, even if the model names it.
        if (opts.tools === false || opts.exclude?.(call.name)) throw new Error(`${call.name} isn't available for this account.`);
        const output = await executeTool(call.name, call.args || {});
        result = output.text;
        if (output.pendingAction) pendingActions.push(output.pendingAction);
        if (output.clientAction) clientActions.push(output.clientAction);
      } catch (error) { result = `Error: ${error instanceof Error ? error.message : String(error)}`; }
      results.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result } } });
    }
    contents.push({ role: "user", parts: results });
  }
  return { reply: "I've paused after several tool calls. Let's handle one task at a time.", pendingActions, clientActions };
}
