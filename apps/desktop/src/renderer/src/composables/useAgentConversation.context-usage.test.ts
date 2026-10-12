import { effectScope } from "vue";
import type { AgentUsage, ModelConfig } from "@deepwrite/contracts";
import {
  createDeferredApi,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";
import { useContextWindowUsage } from "./useContextWindowUsage";
import { latestModelContextTokens } from "../utils/contextWindowUsage";
import { parseStoredMessage } from "./agent-conversation/parse-message";

const contextRuntime = { ...runtime, configId: "context-model" };
const model: ModelConfig = {
  id: contextRuntime.configId,
  label: "Context test model",
  provider: contextRuntime.provider,
  modelId: contextRuntime.model,
  api: "openai-responses",
  baseUrl: "https://api.example.test/v1",
  contextWindow: 200_000,
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["off"],
  temperatureOptions: [0.1, 0.7, 1],
  hasApiKey: false
};

function usage(totalTokens: number): AgentUsage {
  return {
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens
  };
}

describe("conversation context usage after compaction", () => {
  it.each(["prune", "summary"] as const)(
    "keeps the post-run %s occupancy through completion and reload, then measures the next run",
    async (level) => {
      const deferred = createDeferredApi();
      const scope = effectScope();
      const controller = scope.run(() =>
        useAgentConversation({ api: () => deferred.api })
      )!;
      const indicator = scope.run(() =>
        useContextWindowUsage({
          messages: () => controller.messages.value,
          selectedModel: () => model
        })
      )!;
      const sessionId = controller.sessionId.value;

      async function start(runId: string, index: number): Promise<void> {
        controller.draft.value = "继续写";
        const sending = controller.sendMessage(document);
        deferred.resolveAccepted(index, {
          sessionId,
          runId,
          acceptedAt: new Date().toISOString(),
          runtime: contextRuntime
        });
        await sending;
      }

      function observe(runId: string, tokens: number): void {
        controller.handleEvent(
          createEnvelope(
            "agent.usage_observed",
            {
              sessionId,
              runId,
              messageId: `${runId}-message`,
              runtime: contextRuntime,
              observationId: `${runId}:turn:1:attempt:1`,
              observedAt: new Date().toISOString(),
              turnId: `${runId}:turn:1`,
              attempt: 1,
              status: "completed" as const,
              hadToolCall: true,
              usage: usage(tokens)
            },
            eventOptions(sessionId, runId, `${runId}-observed`)
          )
        );
      }

      function complete(runId: string, tokens: number): void {
        controller.handleEvent(
          createEnvelope(
            "agent.message_completed",
            {
              sessionId,
              runId,
              messageId: `${runId}-message`,
              runtime: contextRuntime,
              role: "assistant" as const,
              content: "本轮回答完成",
              usage: usage(tokens)
            },
            eventOptions(sessionId, runId, `${runId}-completed`)
          )
        );
      }

      try {
        const runId = `post-run-${level}`;
        await start(runId, 0);
        observe(runId, 100_000);
        expect(indicator.measurement.value?.usedPercentage).toBe(50);

        controller.handleEvent(
          createEnvelope(
            "agent.context_compaction",
            {
              sessionId,
              runId,
              messageId: `${runId}-message`,
              runtime: contextRuntime,
              phase: "completed" as const,
              reason: "idle" as const,
              level,
              tokensBefore: 100_000,
              tokensAfter: 30_000
            },
            eventOptions(sessionId, runId, `${runId}-compacted`)
          )
        );
        expect(indicator.usedTokens.value).toBe(30_000);
        expect(indicator.measurement.value?.usedPercentage).toBe(15);

        complete(runId, 100_000);
        expect(controller.messages.value.at(-1)).toMatchObject({
          status: "completed",
          contextTokens: 30_000,
          usage: usage(100_000)
        });
        expect(indicator.usedTokens.value).toBe(30_000);
        expect(indicator.measurement.value?.usedPercentage).toBe(15);

        const restored = parseStoredMessage(
          JSON.parse(JSON.stringify(controller.messages.value.at(-1)))
        );
        if (!restored) throw new Error("Stored message did not parse");
        expect(restored.contextTokens).toBe(30_000);
        expect(latestModelContextTokens([restored], model)).toBe(30_000);

        const nextRunId = `next-run-${level}`;
        await start(nextRunId, 1);
        expect(indicator.usedTokens.value).toBe(30_000);
        observe(nextRunId, 35_000);
        expect(indicator.usedTokens.value).toBe(35_000);
        complete(nextRunId, 40_000);
        expect(indicator.usedTokens.value).toBe(40_000);
        expect(indicator.measurement.value?.usedPercentage).toBe(20);
      } finally {
        controller.dispose();
        scope.stop();
      }
    }
  );
});
