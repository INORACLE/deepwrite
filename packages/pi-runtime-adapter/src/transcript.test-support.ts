import {
  getCurrentSystemPrompt,
  getCurrentTools,
  type Context,
  type TranscriptContext
} from "@earendil-works/pi-ai";

/** Inspect the active request head and dialogue through Pi's transcript replay. */
export function inspectTranscript(context: TranscriptContext): Context {
  return {
    systemPrompt: getCurrentSystemPrompt(context.messages),
    tools: getCurrentTools(context.messages),
    messages: context.messages.filter((message) => message.role !== "system")
  };
}
