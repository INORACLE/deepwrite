import type {
  AgentRuntimeRef,
  AgentUsage,
  ModelConfig
} from "@deepwrite/contracts";
import type { ChatMessage } from "../types/conversation";

export interface ContextWindowMeasurement {
  usedTokens: number;
  contextWindow: number;
  usedPercentage: number;
  remainingPercentage: number;
  drawRatio: number;
}

export function contextTokensFromUsage(
  usage: AgentUsage | undefined
): number | undefined {
  if (!usage) return undefined;
  if (usage.totalTokens > 0) return usage.totalTokens;

  const componentTotal =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens;
  return componentTotal > 0 ? componentTotal : undefined;
}

/** The final model call predates a successful post-run compaction. */
export function completedIdleCompactionTokens(
  message: ChatMessage
): number | undefined {
  return [...(message.contextCompactions ?? [])]
    .reverse()
    .find(
      (item) =>
        item.status === "completed" &&
        item.reason === "idle" &&
        item.tokensAfter !== undefined
    )?.tokensAfter;
}

export function runtimeMatchesModel(
  runtime: AgentRuntimeRef | undefined,
  model: ModelConfig
): boolean {
  return (
    runtime?.configId === model.id &&
    runtime.provider === model.provider &&
    runtime.model === model.modelId
  );
}

export function latestModelContextTokens(
  messages: readonly ChatMessage[],
  model: ModelConfig | undefined
): number | undefined {
  if (!model) return undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role !== "assistant" ||
      !runtimeMatchesModel(message.runtime, model)
    ) {
      continue;
    }

    // Older histories may have saved terminal usage over the post-run value.
    const idleTokens = completedIdleCompactionTokens(message);
    if (idleTokens !== undefined) {
      return idleTokens > 0 ? idleTokens : undefined;
    }

    if (message.contextTokens !== undefined) {
      return message.contextTokens > 0 ? message.contextTokens : undefined;
    }

    const compaction = [...(message.contextCompactions ?? [])]
      .reverse()
      .find(
        (item) => item.status === "completed" && item.tokensAfter !== undefined
      );
    if (compaction && (message.status === "streaming" || !message.usage))
      return compaction.tokensAfter;
    const usedTokens = contextTokensFromUsage(message.usage);
    if (usedTokens !== undefined) return usedTokens;

    // A live placeholder has no terminal usage yet. Keep the previous real
    // measurement for this model until the current call completes.
    if (message.status === "streaming") continue;
    return undefined;
  }
  return undefined;
}

export function createContextWindowMeasurement(
  usedTokens: number | undefined,
  contextWindow: number | undefined
): ContextWindowMeasurement | undefined {
  if (
    usedTokens === undefined ||
    contextWindow === undefined ||
    usedTokens <= 0 ||
    contextWindow <= 0
  ) {
    return undefined;
  }

  const usedPercentage = (usedTokens / contextWindow) * 100;
  return {
    usedTokens,
    contextWindow,
    usedPercentage,
    remainingPercentage: Math.max(0, 100 - usedPercentage),
    drawRatio: Math.min(1, usedTokens / contextWindow)
  };
}

export function formatContextPercentage(value: number): string {
  if (value > 0 && value < 0.1) return "<0.1%";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("zh-CN", {
    maximumFractionDigits: 1
  })}%`;
}

export function formatContextTokens(value: number): string {
  return value.toLocaleString("zh-CN");
}
