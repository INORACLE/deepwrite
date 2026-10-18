import type {
  AgentMessage,
  StreamFn,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type Model,
  type UserMessage,
  type Usage
} from "@earendil-works/pi-ai";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import {
  buildWorkspaceProviderRuntimes,
  toPiThinkingLevel
} from "../provider-runtime";
import type { AgentRunPlan, AgentRunTarget } from "./run-plan";

export interface RunModel {
  model: Model<Api>;
  streamFn: StreamFn;
  spawnStreamFn: StreamFn;
  thinkingLevel: PiThinkingLevel;
}

/** Resolves the configured provider, or the local faux model when none is set. */
export function resolveRunModel(
  plan: AgentRunPlan,
  runtime: AgentRuntimeRef,
  tokensPerSecond: number
): RunModel {
  const { target } = plan;
  if (target.runtimeConfig) {
    const configuredThinkingLevel =
      target.thinkingLevel ?? target.runtimeConfig.defaultThinkingLevel;
    const effectiveTemperature =
      configuredThinkingLevel === "off"
        ? (target.temperature ?? target.runtimeConfig.temperatureOptions[1])
        : undefined;
    const providerRuntime = buildWorkspaceProviderRuntimes(
      target.runtimeConfig,
      effectiveTemperature,
      configuredThinkingLevel,
      { portableToolSchemaProfile: plan.portableToolSchemaProfile }
    );
    return {
      model: providerRuntime.model,
      streamFn: providerRuntime.streamFn,
      spawnStreamFn: providerRuntime.spawnStreamFn,
      thinkingLevel: toPiThinkingLevel(configuredThinkingLevel)
    };
  }
  const models = createModels();
  const faux = fauxProvider({
    api: "deepwrite-faux",
    provider: runtime.provider,
    models: [
      {
        id: runtime.model,
        name: "DeepWrite Local Writing Faux",
        reasoning: true,
        input: ["text"]
      }
    ],
    tokensPerSecond,
    tokenSize: { min: 2, max: 4 }
  });
  models.setProvider(faux.provider);
  const fauxModel = faux.getModel(runtime.model);
  if (!fauxModel) {
    throw new Error("DeepWrite faux model is unavailable.");
  }
  const streamFn = models.streamSimple.bind(models) as StreamFn;
  const thinkingLevel = toPiThinkingLevel(target.thinkingLevel ?? "medium");
  faux.setResponses(plan.fauxResponses(thinkingLevel));
  return { model: fauxModel, streamFn, spawnStreamFn: streamFn, thinkingLevel };
}

export function assertAttachmentsSupported(
  target: AgentRunTarget,
  model: Model<Api>,
  runtime: AgentRuntimeRef
): void {
  const imageAttachments =
    target.attachments?.filter((attachment) => attachment.kind === "image") ??
    [];
  if (imageAttachments.length && !model.input.includes("image")) {
    throw new Error(
      runtime.mode === "local-faux"
        ? "DeepWrite Faux 不支持图片理解，请先选择支持多模态的真实模型。"
        : `当前模型 ${runtime.model} 不支持图片输入，请更换支持多模态的模型。`
    );
  }
}

const EMPTY_RESTORED_MESSAGE_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};

export function restoredConversationMessages(
  target: AgentRunTarget,
  model: Model<Api>
): AgentMessage[] {
  return (target.conversationHistory ?? []).map((message) => {
    const timestamp = Date.parse(message.createdAt);
    if (message.role === "user") {
      return {
        role: "user",
        content: message.content,
        timestamp
      } satisfies UserMessage;
    }
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: EMPTY_RESTORED_MESSAGE_USAGE,
      stopReason: "stop",
      timestamp
    } satisfies AssistantMessage;
  });
}
