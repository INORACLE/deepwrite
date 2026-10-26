import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  type Message,
  type Tool
} from "@earendil-works/pi-ai";
import {
  inPlaceSummaryPrompt,
  summaryLengthInstruction
} from "./summary-prompts";
import type { SummaryModel, SummaryRequest } from "./summarize";
import { streamSummary } from "./summary-stream";

/** The run's own request head: same system prompt, tools and cache key. */
export interface InPlaceSummaryTarget {
  systemPrompt: string;
  tools: readonly Tool[];
  sessionId: string | undefined;
}

/**
 * Summarizes by appending one instruction to exactly what the run already
 * sent, so the provider can serve everything before it from its prompt
 * cache. Throws when the model answers with a tool call or no text, and the
 * caller falls back to the serialized summary.
 */
export async function summarizeInPlace(
  summaryModel: SummaryModel,
  target: InPlaceSummaryTarget,
  messages: readonly AgentMessage[],
  request: SummaryRequest
): Promise<string> {
  if (summaryModel.local) throw new Error("本地模拟不使用原位摘要。");
  request.signal.throwIfAborted();
  const { thinkingLevel } = summaryModel;
  // Same conversion the agent loop applies before every request.
  const sent = messages.filter(
    (message): message is Message =>
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
  );
  const result = await streamSummary(
    summaryModel,
    normalizeContext({
      ...(sent.some((message) => message.role === "system")
        ? {}
        : { systemPrompt: target.systemPrompt, tools: [...target.tools] }),
      messages: [
        ...sent,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                inPlaceSummaryPrompt(request.task, request.instructions),
                summaryLengthInstruction(request.targetTokens)
              ].join("\n\n")
            }
          ],
          timestamp: Date.now()
        }
      ]
    }),
    {
      // Preserve the selected model's limit and thinking level through Pi.
      maxRetries: 0,
      ...(target.sessionId ? { sessionId: target.sessionId } : {}),
      ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel })
    },
    request.signal
  );
  request.onUsage({
    usage: result.usage,
    runtime: summaryModel.runtime,
    status:
      result.stopReason === "aborted"
        ? "aborted"
        : result.stopReason === "stop"
          ? "completed"
          : "error"
  });
  request.signal.throwIfAborted();
  const text = result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  if (
    result.stopReason !== "stop" ||
    result.content.some((block) => block.type === "toolCall") ||
    !text ||
    text.length > 32_000
  )
    throw new Error("原位摘要未返回可用检查点。");
  return text;
}
