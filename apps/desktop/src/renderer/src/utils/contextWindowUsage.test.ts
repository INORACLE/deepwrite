import { describe, expect, it } from "vitest";
import type { AgentUsage, ModelConfig } from "@deepwrite/contracts";
import type { ChatMessage } from "../types/conversation";
import { parseStoredMessage } from "../composables/agent-conversation/parse-message";
import {
  contextTokensFromUsage,
  createContextWindowMeasurement,
  formatContextPercentage,
  formatContextTokens,
  latestModelContextTokens
} from "./contextWindowUsage";

const model: ModelConfig = {
  id: "model-config-1",
  label: "Example Writer",
  provider: "example",
  modelId: "writer-1",
  api: "openai-responses",
  baseUrl: "https://api.example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "medium",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.1, 0.7, 1],
  hasApiKey: true
};

const runtime = {
  provider: model.provider,
  model: model.modelId,
  mode: "provider" as const,
  configId: model.id
};

function usage(totalTokens: number, inputTokens = totalTokens): AgentUsage {
  return {
    inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens
  };
}

function assistantMessage(
  id: string,
  totalTokens: number,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "完成",
    createdAt: "2026-08-28T08:00:00.000Z",
    status: "completed",
    runtime,
    usage: usage(totalTokens),
    ...overrides
  };
}

describe("context window usage", () => {
  it("uses totalTokens and falls back to provider token components", () => {
    expect(contextTokensFromUsage(usage(345))).toBe(345);
    expect(
      contextTokensFromUsage({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 4,
        totalTokens: 0
      })
    ).toBe(154);
    expect(contextTokensFromUsage(usage(0))).toBeUndefined();
  });

  it("reads only the latest matching main-model call without accumulating", () => {
    const messages: ChatMessage[] = [
      assistantMessage("first", 120),
      assistantMessage("second", 260, {
        subagentRuns: [
          {
            parentToolCallId: "tool-1",
            subagentRunId: "subagent-run-1",
            subagentId: "researcher",
            name: "Researcher",
            task: "查资料",
            status: "completed",
            runtime,
            toolCalls: [],
            processingSteps: [],
            startedAt: "2026-08-28T08:00:00.000Z",
            completedAt: "2026-08-28T08:01:00.000Z",
            usage: usage(9_999)
          }
        ]
      })
    ];

    expect(latestModelContextTokens(messages, model)).toBe(260);
  });

  it("ignores calls from a different config, provider, or model", () => {
    const messages = [
      assistantMessage("matching", 240),
      assistantMessage("other-config", 600, {
        runtime: { ...runtime, configId: "model-config-2" }
      }),
      assistantMessage("other-provider", 700, {
        runtime: { ...runtime, provider: "another" }
      }),
      assistantMessage("other-model", 800, {
        runtime: { ...runtime, model: "writer-2" }
      })
    ];

    expect(latestModelContextTokens(messages, model)).toBe(240);
  });

  it("retains the prior real value while streaming, then clears on zero terminal usage", () => {
    const previous = assistantMessage("previous", 240);
    const streaming = assistantMessage("streaming", 0, {
      status: "streaming"
    });
    delete streaming.usage;
    expect(latestModelContextTokens([previous, streaming], model)).toBe(240);

    const completed = { ...streaming, status: "completed" as const };
    expect(
      latestModelContextTokens([previous, completed], model)
    ).toBeUndefined();
  });

  it("uses the latest live observation across tool turns and compaction", () => {
    const message = assistantMessage("running", 100, {
      status: "streaming",
      contextCompactions: [
        {
          id: "compaction",
          status: "completed",
          reason: "threshold",
          createdAt: "2026-08-28T08:00:00.000Z",
          tokensAfter: 80
        }
      ]
    });
    message.contextTokens = 80;
    expect(latestModelContextTokens([message], model)).toBe(80);

    message.contextTokens = 120;
    expect(latestModelContextTokens([message], model)).toBe(120);

    message.contextTokens = 0;
    expect(latestModelContextTokens([message], model)).toBeUndefined();
  });

  it.each(["prune", "summary"] as const)(
    "restores the post-run %s measurement even when saved terminal usage is stale",
    (level) => {
      const saved = assistantMessage("compacted", 100_000, {
        contextTokens: 100_000,
        contextCompactions: [
          {
            id: "post-run-compaction",
            status: "completed",
            reason: "idle",
            level,
            createdAt: "2026-08-28T08:00:00.000Z",
            tokensBefore: 100_000,
            tokensAfter: 30_000
          }
        ]
      });
      const restored = parseStoredMessage(JSON.parse(JSON.stringify(saved)));
      if (!restored) throw new Error("Stored message did not parse");

      expect(latestModelContextTokens([restored], model)).toBe(30_000);
      expect(restored.usage?.totalTokens).toBe(100_000);
    }
  );

  it.each(["running", "failed"] as const)(
    "keeps the measured value when a post-run compaction is %s",
    (status) => {
      const message = assistantMessage("uncompacted", 100_000, {
        contextTokens: 100_000,
        contextCompactions: [
          {
            id: "unfinished-compaction",
            status,
            reason: "idle",
            createdAt: "2026-08-28T08:00:00.000Z",
            tokensAfter: 30_000
          }
        ]
      });

      expect(latestModelContextTokens([message], model)).toBe(100_000);
    }
  );

  it("clamps only the ring drawing when usage exceeds the context window", () => {
    expect(createContextWindowMeasurement(300_000, 272_000)).toEqual({
      usedTokens: 300_000,
      contextWindow: 272_000,
      usedPercentage: (300_000 / 272_000) * 100,
      remainingPercentage: 0,
      drawRatio: 1
    });
  });

  it("formats tooltip percentages and exact token counts", () => {
    expect(formatContextPercentage(5)).toBe("5%");
    expect(formatContextPercentage(5.25)).toBe("5.3%");
    expect(formatContextPercentage(0.02)).toBe("<0.1%");
    expect(formatContextTokens(272_000)).toBe("272,000");
  });
});
