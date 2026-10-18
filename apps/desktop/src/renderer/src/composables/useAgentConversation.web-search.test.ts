import {
  createDeferredApi,
  describe,
  document,
  expect,
  it,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

function writerModel(id: string, provider: string) {
  return {
    id,
    label: `${provider} writer`,
    provider,
    modelId: "writer-model",
    api: "openai-responses" as const,
    baseUrl: "https://api.example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "high" as const,
    thinkingLevelOptions: ["low", "high"] as ["low", "high"],
    temperatureOptions: [0.1, 0.7, 1] as [number, number, number],
    hasApiKey: true
  };
}

async function sendOnce(
  controller: ReturnType<typeof useAgentConversation>,
  deferred: ReturnType<typeof createDeferredApi>,
  provider: string
) {
  controller.draft.value = "查一下近期同类题材";
  const sending = controller.sendMessage(document);
  deferred.resolveAccepted(0, {
    sessionId: controller.sessionId.value,
    runId: "run_workspace_web_search",
    acceptedAt: new Date().toISOString(),
    runtime: { provider, model: "writer-model", mode: "provider" }
  });
  await sending;
}

describe("agent conversation controller: web search switch", () => {
  it("starts off and sends no flag", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [writerModel("writer", "openai")]
    });
    expect(controller.webSearchEnabled.value).toBe(false);

    await sendOnce(controller, deferred, "openai");

    expect(deferred.prompts[0]).not.toHaveProperty("webSearchEnabled");
    controller.dispose();
  });

  it("sends the flag for any model once the switch is on", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [writerModel("writer", "openai")]
    });
    expect(controller.selectWebSearchEnabled(true)).toBeUndefined();
    expect(controller.webSearchEnabled.value).toBe(true);

    await sendOnce(controller, deferred, "openai");

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "writer",
      webSearchEnabled: true
    });
    expect(deferred.prompts[0]).not.toHaveProperty("webSearch");
    controller.dispose();
  });

  it("keeps the switch when the model changes", () => {
    const warning = vi.fn();
    const controller = useAgentConversation({
      api: () => undefined,
      onContextWarning: warning
    });
    controller.applyModelSettings({
      defaultModelId: "deepseek-writer",
      models: [
        writerModel("deepseek-writer", "deepseek"),
        writerModel("openai-writer", "openai")
      ]
    });
    controller.selectWebSearchEnabled(true);

    controller.selectModel("openai-writer");

    expect(controller.webSearchEnabled.value).toBe(true);
    expect(warning).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("restores the switch with the saved run settings", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controller.applyModelSettings({
      defaultModelId: "writer",
      models: [writerModel("writer", "openai")]
    });
    controller.applyRunSettings({
      selectedModelId: "writer",
      thinkingLevel: "high",
      temperature: 0.7,
      approvalMode: "request-approval",
      webSearchEnabled: true
    });
    expect(controller.webSearchEnabled.value).toBe(true);
    controller.applyRunSettings({
      selectedModelId: "writer",
      thinkingLevel: "high",
      temperature: 0.7,
      approvalMode: "request-approval",
      webSearchEnabled: false
    });
    expect(controller.webSearchEnabled.value).toBe(false);
    controller.dispose();
  });
});
