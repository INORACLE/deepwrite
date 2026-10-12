import { describe, expect, it } from "vitest";
import type {
  AgentMessage,
  PrepareNextTurnContext,
  StreamFn
} from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-ai";
import { inspectTranscript } from "../../transcript.test-support";
import {
  assistant,
  manager,
  policy,
  response,
  user
} from "./context.test-support";
import { SUMMARY_SYSTEM_PROMPT } from "./summary-prompts";

const childPolicy = {
  ...policy,
  settings: { enabled: true, budgetTokens: 4000 },
  task: "book-decomposition-unit" as const,
  thresholdCompaction: false,
  inPlaceSummary: true
};

function splitTurn(streamFn: StreamFn) {
  const task = user("【本任务材料】".repeat(150));
  const first = assistant("第一段核对".repeat(600));
  const second = assistant("第二段".repeat(400));
  const setup = manager([task, first, second], {
    policy: childPolicy,
    streamFn
  });
  setup.guard.noteRunStart(task, undefined);
  const next = () =>
    setup.guard.prepareNextTurn({
      context: {
        systemPrompt: setup.agent.state.systemPrompt,
        messages: setup.agent.state.messages,
        tools: []
      }
    } as unknown as PrepareNextTurnContext);
  return { ...setup, task, first, second, next };
}

describe("in-place summary of a child's own turn", () => {
  it("continues the run's request so its prefix can come from the cache", async () => {
    const requests: Context[] = [];
    const { agent, task, second, next } = splitTurn((_model, context) => {
      requests.push(inspectTranscript(context));
      return response(assistant("## 已完成\n- chunk:1 已保存"));
    });
    await next();
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.systemPrompt).toBe("写作");
    expect(request!.messages[0]).toBe(task);
    expect(JSON.stringify(request!.messages.at(-1))).toContain("上下文整理");
    const messages: AgentMessage[] = agent.state.messages.filter(
      (message) => message.role !== "system"
    );
    expect(messages.slice(1)).toEqual([task, second]);
    expect(JSON.stringify(messages[0])).toContain("chunk:1 已保存");
  });

  it("falls back to the serialized summary when the model calls a tool", async () => {
    const systems: Array<string | undefined> = [];
    const { agent, task, next } = splitTurn((_model, context) => {
      const { systemPrompt } = inspectTranscript(context);
      systems.push(systemPrompt);
      if (systemPrompt === SUMMARY_SYSTEM_PROMPT) return response();
      const call = assistant("", "toolUse");
      call.content = [
        { type: "toolCall", id: "call", name: "search_source", arguments: {} }
      ];
      return response(call);
    });
    await next();
    expect(systems).toEqual(["写作", SUMMARY_SYSTEM_PROMPT]);
    expect(agent.state.messages).toContain(task);
    expect(
      JSON.stringify(
        agent.state.messages.find((message) => message.role === "user")
      )
    ).toContain("梦境结局");
  });
});
