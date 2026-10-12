import { describe, expect, it } from "vitest";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { ConversationCheckpointSchema } from "@deepwrite/contracts";
import {
  manager,
  model,
  policy,
  response,
  user,
  assistant
} from "./context.test-support";
import { textOf } from "./prune";
import { estimateContextTokens } from "./token-count";
import { runAgentWithTurnRetries } from "../../agent-turn-retry";

describe("conversation compaction lifecycle", () => {
  it("budgets the incoming request and keeps its words verbatim", async () => {
    const old = user("旧约束".repeat(4_000));
    const { agent, guard, events } = manager([old, assistant()]);
    const incoming = user("继续写正文".repeat(1_000), 3);
    guard.noteRunStart(incoming, incoming.content);
    await guard.beforeRun(incoming);
    expect(guard.state.checkpoint?.summary).toContain("梦境结局");
    expect(agent.state.messages).not.toContain(old);
    expect(agent.state.messages).not.toContain(incoming);
    expect(incoming.content).toBe("继续写正文".repeat(1_000));
    guard.assertFits(incoming);
    const completed = events.find(
      (event) =>
        event.type === "agent.context_compaction" && event.payload.checkpoint
    );
    expect(completed).toBeDefined();
    expect(
      ConversationCheckpointSchema.safeParse(guard.state.checkpoint).success
    ).toBe(true);
  });

  it("rolls back pruning bookkeeping and history after summary failure", async () => {
    const original = user("快照".repeat(5_000));
    const answer = assistant("答".repeat(8_000));
    const { guard, agent, invalidated, events } = manager([original, answer], {
      policy: { ...policy, manual: {} },
      streamFn: () =>
        response({
          ...assistant("", "error"),
          errorMessage: "invalid summary model"
        })
    });
    guard.state.runtimeTurns.set(original, {
      rawContent: "不可失去的要求",
      snapshot: true
    });
    const incoming = user("继续", 3);
    guard.noteRunStart(incoming, incoming.content);
    await guard.beforeRun(incoming);
    expect(
      agent.state.messages.filter((message) => message.role !== "system")
    ).toEqual([original, answer]);
    expect(getCurrentSystemPrompt(agent.state.messages)).toBe("写作");
    expect(guard.state.pruned.has(original)).toBe(false);
    expect(guard.state.checkpoint).toBeUndefined();
    expect(invalidated()).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: "agent.context_compaction",
      payload: { phase: "failed" }
    });
  });

  it("refreshes a cached checkpoint from current sources and restores run boundaries", async () => {
    let skill = "旧技能";
    const checkpoint = {
      summary: "保持克制",
      firstKeptRunId: "old-run",
      createdAt: new Date(1).toISOString(),
      tokensBefore: 90_000
    };
    const { guard, agent } = manager([user("原话", 10)], {
      policy: { ...policy, checkpoint, rehydrate: async () => skill }
    });
    await guard.restore([
      {
        role: "user",
        content: "原话",
        createdAt: new Date(10).toISOString(),
        runId: "old-run"
      }
    ]);
    expect(guard.state.runStarts.get(agent.state.messages[2]!)).toBe("old-run");
    skill = "修订后的技能";
    await guard.beforeRun();
    expect(
      textOf((agent.state.messages[1] as ReturnType<typeof user>).content)
    ).toContain(skill);
    expect(
      textOf((agent.state.messages[1] as ReturnType<typeof user>).content)
    ).not.toContain("旧技能");
  });

  it("refuses an unsplittable oversized first message without deleting it", async () => {
    const { guard, agent } = manager([]);
    const incoming = user("字".repeat(40_000));
    guard.noteRunStart(incoming, incoming.content);
    await guard.beforeRun(incoming);
    expect(() => guard.assertFits(incoming)).toThrow("原文已保留");
    expect(incoming.content).toHaveLength(40_000);
    expect(
      agent.state.messages.filter((message) => message.role !== "system")
    ).toEqual([]);
  });

  it("precompacts a completed conversation and keeps the current answer", async () => {
    const latest = assistant("下一章从码头开始");
    const { guard, agent, events } = manager([
      user("旧约束".repeat(5_000)),
      assistant(),
      user("继续", 3),
      latest
    ]);
    guard.noteRunStart(
      agent.state.messages[3] as ReturnType<typeof user>,
      "继续"
    );
    await guard.afterRun();
    expect(agent.state.messages).toContain(latest);
    expect(getCurrentSystemPrompt(agent.state.messages)).toBe("写作");
    expect(events.at(-1)).toMatchObject({
      type: "agent.context_compaction",
      payload: { phase: "completed", reason: "idle" }
    });
  });

  it("never uses another model's measured usage to size this request", () => {
    const prior = {
      ...assistant(),
      model: "other-model",
      usage: { ...assistant().usage, totalTokens: 100_000 }
    };
    expect(estimateContextTokens([prior], 500, 0, model)).toMatchObject({
      measured: false
    });
  });

  it("recovers overflow only once and preserves a second provider failure", async () => {
    let calls = 0;
    const overflow = {
      ...assistant("", "error"),
      errorMessage: "maximum context length exceeded"
    };
    const { agent, guard } = manager(
      [user("旧历史".repeat(500)), assistant()],
      {
        streamFn: (_model, context) => {
          if (getCurrentSystemPrompt(context.messages).includes("上下文整理员"))
            return response();
          calls += 1;
          return response(overflow);
        }
      }
    );
    const incoming = user("继续", 3);
    guard.noteRunStart(incoming, incoming.content);
    await runAgentWithTurnRetries({
      agent,
      initialPrompt: incoming,
      runId: "run-new",
      contextOverflow: {
        matches: (message) => guard.matchesOverflow(message),
        recover: (message) => guard.recoverOverflow(message)
      },
      onEvent: () => {}
    });
    expect(calls).toBe(2);
    expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: "error" });
    expect(guard.matchesOverflow(overflow)).toBe(false);
  });
  it("keeps old image evidence when text is summarized", async () => {
    const image = {
      ...user("image"),
      content: [
        { type: "text" as const, text: "按图中服饰描写" },
        { type: "image" as const, data: "aW52YWxpZA==", mimeType: "image/png" }
      ]
    };
    const { agent, guard } = manager(
      [image, assistant("较早的讨论".repeat(2_000))],
      { policy: { ...policy, manual: {} } }
    );
    const incoming = user("继续", 3);
    guard.noteRunStart(incoming, incoming.content);
    await guard.beforeRun(incoming);
    expect(guard.state.checkpoint).toBeDefined();
    expect(agent.state.messages).toContain(image);
  });
});
