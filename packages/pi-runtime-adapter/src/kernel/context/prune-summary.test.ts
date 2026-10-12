import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { ConversationContextState } from "./state";
import { pruneMessages, textOf } from "./prune";
import { findCutPoint } from "./cut-point";
import { summarizeMessages } from "./summarize";
import {
  model,
  runtime,
  response,
  assistant,
  user
} from "./context.test-support";
import { WORKSPACE_TOOL_COMPACTORS } from "../../workspace-context-policy";

const result = (name: string, content: string): AgentMessage => ({
  role: "toolResult",
  toolName: name,
  toolCallId: name,
  content: [{ type: "text", text: content }],
  isError: false,
  timestamp: 2
});

describe("loss-aware context pruning and summarization", () => {
  it("preserves full user constraints, questionnaire answers, loaded skills and unknown tool findings", () => {
    const state = new ConversationContextState();
    const raw = `开始${"中".repeat(5_000)}用户禁用梦境结局${"末".repeat(5_000)}`;
    const message = user(`生成的快照${raw}`);
    state.runtimeTurns.set(message, { rawContent: raw, snapshot: true });
    const answer = result("ask_user_question", raw);
    const skill = result("load_skill", raw);
    const unknown = result("research", raw);
    const messages = [message, answer, skill, unknown, result("read", raw)];
    const pruned = pruneMessages(
      messages,
      messages.length,
      WORKSPACE_TOOL_COMPACTORS,
      state
    );
    expect(
      textOf((pruned.messages[0] as ReturnType<typeof user>).content)
    ).toContain(raw);
    expect(pruned.messages.slice(1, 4)).toEqual([answer, skill, unknown]);
    expect(JSON.stringify(pruned.messages[4])).not.toContain(raw);
    expect(message.content).toContain("生成的快照");
  });

  it("cuts before calls rather than between a call and its results", () => {
    const call = {
      ...assistant(),
      content: [
        { type: "toolCall" as const, id: "read", name: "read", arguments: {} }
      ]
    };
    const messages = [
      user("开始"),
      call,
      result("read", "字".repeat(10_000)),
      assistant("工作中"),
      call,
      result("read", "短结果")
    ];
    const cut = findCutPoint(
      messages,
      0,
      500,
      (message) => message.role === "user",
      true
    );
    expect(cut).toMatchObject({
      isSplitTurn: true,
      turnStartIndex: 0,
      firstKeptIndex: 3
    });
    expect(messages[cut!.firstKeptIndex]!.role).toBe("assistant");
  });

  it("feeds the middle and end of long user and tool input through bounded summary requests", async () => {
    const prompts: string[] = [];
    await summarizeMessages(
      {
        model: { ...model, contextWindow: 5_000, maxTokens: 300 },
        runtime,
        local: false,
        thinkingLevel: "off",
        streamFn: (_model, context) => {
          const prompt = textOf(
            (
              context.messages.find(
                (message) => message.role === "user"
              ) as ReturnType<typeof user>
            ).content
          );
          prompts.push(prompt);
          return response();
        }
      },
      [
        user("甲".repeat(4_000) + "中间的硬约束" + "乙".repeat(4_000)),
        result("query", "丙".repeat(4_000) + "素材末尾的结论")
      ],
      undefined,
      {
        task: "short-plot",
        maxTokens: 300,
        signal: new AbortController().signal,
        state: new ConversationContextState(),
        onUsage: () => {}
      }
    );
    expect(prompts.length).toBeGreaterThan(2);
    const transcript = prompts
      .map(
        (prompt) =>
          /<conversation>\n([\s\S]*?)\n<\/conversation>/.exec(prompt)?.[1]
      )
      .join("");
    expect(transcript).toContain("中间的硬约束");
    expect(transcript).toContain("素材末尾的结论");
  });

  it("does not commit an incomplete summary or summarize after cancellation", async () => {
    const summary = {
      model,
      runtime,
      local: false,
      thinkingLevel: "off" as const,
      streamFn: () => response(assistant("不完整", "length"))
    };
    const request = {
      task: "short-draft" as const,
      maxTokens: 500,
      signal: new AbortController().signal,
      state: new ConversationContextState(),
      onUsage: () => {}
    };
    await expect(
      summarizeMessages(summary, [user("要求")], undefined, request)
    ).rejects.toThrow("不完整");
    const abort = new AbortController();
    abort.abort();
    await expect(
      summarizeMessages(summary, [user("要求")], undefined, {
        ...request,
        signal: abort.signal
      })
    ).rejects.toBeDefined();
  });
  it("cancels a provider stream that never finishes", async () => {
    const controller = new AbortController();
    const pending = summarizeMessages(
      {
        model,
        runtime,
        local: false,
        thinkingLevel: "off",
        streamFn: () => createAssistantMessageEventStream()
      },
      [user("整理")],
      undefined,
      {
        task: "general",
        maxTokens: 300,
        signal: controller.signal,
        state: new ConversationContextState(),
        onUsage: () => {}
      }
    );
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});
