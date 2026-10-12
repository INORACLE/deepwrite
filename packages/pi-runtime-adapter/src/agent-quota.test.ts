import { expect, it, vi } from "vitest";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model
} from "@earendil-works/pi-ai";
import { runAgentWithTurnRetries } from "./agent-turn-retry";

const model: Model<"openai-completions"> = {
  id: "quota-test",
  name: "Quota test",
  api: "openai-completions",
  provider: "custom",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_000,
  maxTokens: 1000
};

it.each(["429 insufficient_quota", "429 用户余额不足，请充值后重试。"])(
  "主控和子智能体共用的请求重试对额度错误直接结束：%s",
  async (errorMessage) => {
    const failure: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [],
      stopReason: "error",
      errorMessage,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      timestamp: Date.now()
    };
    const streamFn = vi.fn(async () => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "error", reason: "error", error: failure });
      return stream;
    });
    const agent = new Agent({
      initialState: { model, systemPrompt: "合成测试", thinkingLevel: "off" },
      streamFn
    });
    const retry = vi.fn();
    const forwarded: string[] = [];
    await runAgentWithTurnRetries({
      agent,
      initialPrompt: { role: "user", content: "合成任务", timestamp: 1 },
      runId: "run_quota",
      retryPolicy: { delaysMs: [0, 0], sleep: async () => {} },
      onRetryScheduled: retry,
      onEvent: (event) => {
        if (event.type === "message_end" && event.message.role === "assistant")
          forwarded.push(event.message.errorMessage ?? "");
      }
    });
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(forwarded).toEqual([errorMessage]);
    expect(agent.state.messages.at(-1)).toMatchObject({
      stopReason: "error",
      errorMessage
    });
  }
);
