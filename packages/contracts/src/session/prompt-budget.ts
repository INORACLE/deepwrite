import type { ErrorPayload } from "../error-payload";
import { ESTIMATED_IMAGE_TOKENS, estimateTextTokens } from "../token-estimate";
import type { UserPromptAttachment } from "./attachments";
import { DEFAULT_CONTEXT_COMPACTION_BUDGET_TOKENS } from "./context-compaction-defaults";

export interface ConversationPromptInput {
  message: string;
  attachments?: readonly UserPromptAttachment[] | undefined;
}

/** Reserve space for system instructions, tools, summaries and runtime context. */
export function conversationPromptTokenLimit(budgetTokens: number): number {
  return Math.floor(budgetTokens * 0.9);
}

export function estimateConversationPromptTokens(
  input: ConversationPromptInput
): number {
  let tokens = estimateTextTokens(input.message.trim());
  for (const attachment of input.attachments ?? []) {
    // Includes the name, media type and the runtime's attachment wrapper.
    tokens += 32 + estimateTextTokens(attachment.name + attachment.mediaType);
    tokens +=
      attachment.kind === "text"
        ? estimateTextTokens(attachment.content)
        : ESTIMATED_IMAGE_TOKENS;
  }
  return tokens;
}

/** Shared preflight: Renderer previews; Main and Agent use authoritative settings. */
export function conversationPromptBudgetError(
  input: ConversationPromptInput,
  budgetTokens = DEFAULT_CONTEXT_COMPACTION_BUDGET_TOKENS
): ErrorPayload | undefined {
  const inputTokens = estimateConversationPromptTokens(input);
  const maxInputTokens = conversationPromptTokenLimit(budgetTokens);
  if (inputTokens <= maxInputTokens) return undefined;
  return {
    code: "session.prompt_budget_exceeded",
    message: `消息和附件约 ${inputTokens.toLocaleString("zh-CN")} token，超过当前可用的 ${maxInputTokens.toLocaleString("zh-CN")} token。已按压缩上下文上限 ${budgetTokens.toLocaleString("zh-CN")} token 预留 10% 余量，请缩短内容或调整设置。`,
    details: { budgetTokens, inputTokens, maxInputTokens }
  };
}

export function assertConversationPromptBudget(
  input: ConversationPromptInput,
  budgetTokens?: number
): void {
  const error = conversationPromptBudgetError(input, budgetTokens);
  if (error) throw new Error(error.message);
}
