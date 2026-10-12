import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";
import { findDeepWriteRuntimeModel } from "./runtime-model-catalog";

const { streamSimple } = vi.hoisted(() => ({ streamSimple: vi.fn() }));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ streamSimple })
}));

const config: AgentProviderRuntimeConfig = {
  id: "custom-pro",
  label: "My Pro route",
  provider: "deepseek",
  modelId: "deepseek-v4-pro-custom-route",
  requestModelId: "gateway-pro",
  api: "openai-completions",
  baseUrl: "https://gateway.example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["low", "high", "max"],
  temperatureOptions: [0.2, 0.6, 1.2],
  apiKey: "invalid-catalog-test-key"
};

describe("provider catalog precedence", () => {
  beforeEach(() => {
    streamSimple.mockReset();
    streamSimple.mockReturnValue(createAssistantMessageEventStream());
  });

  it("uses Pi metadata while preserving the configured request route and key", async () => {
    const builtin = getBuiltinModels("deepseek").find(
      (model) => model.id === "deepseek-v4-pro"
    )!;
    const { model, streamFn } = buildProviderRuntime(config);

    expect(model).toMatchObject({
      id: "gateway-pro",
      name: config.label,
      provider: config.provider,
      api: config.api,
      baseUrl: config.baseUrl,
      input: builtin.input,
      reasoning: builtin.reasoning,
      cost: builtin.cost,
      contextWindow: builtin.contextWindow,
      maxTokens: builtin.maxTokens,
      thinkingLevelMap: builtin.thinkingLevelMap
    });

    const context = {
      messages: [{ role: "user" as const, content: "Test", timestamp: 0 }]
    };
    await streamFn(model, context, { apiKey: "invalid-other-test-key" });
    expect(streamSimple).toHaveBeenCalledWith(
      model,
      context,
      expect.objectContaining({ apiKey: config.apiKey })
    );
  });

  it("keeps saved capacity overrides when Pi recognizes the model", () => {
    const { model } = buildProviderRuntime({
      ...config,
      contextWindow: 32_000,
      maxTokens: 4_096
    });
    expect(model).toMatchObject({ contextWindow: 32_000, maxTokens: 4_096 });
  });

  it("uses DeepWrite metadata when the configured provider has no Pi match", () => {
    const local = findDeepWriteRuntimeModel(config.modelId)!;
    const { model } = buildProviderRuntime({ ...config, provider: "custom" });
    expect(model).toMatchObject({
      id: config.requestModelId,
      provider: "custom",
      baseUrl: config.baseUrl,
      contextWindow: local.contextWindow,
      maxTokens: local.maxTokens,
      thinkingLevelMap: local.thinkingLevelMap,
      cost: local.cost
    });
  });
});
