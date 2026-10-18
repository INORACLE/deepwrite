import { describe, expect, it } from "vitest";
import type { ExtrasAgentResolvedTask } from "@deepwrite/contracts";
import type { AgentRuntimeEvent } from "../runtime-types";
import { chatRoleplayTask } from "./agents/chat.test-support";
import { planExtrasRun } from "./run-plan";

const runtime = { provider: "test", model: "test", mode: "provider" as const };
const styleTask: ExtrasAgentResolvedTask = {
  agentId: "style-comparison",
  profile: {
    id: "default",
    name: "文风比对",
    description: "测试",
    systemPrompt: ""
  },
  input: { jobId: "job", referenceText: "甲。", comparisonText: "乙。" }
};
const result = {
  summary: "接近。",
  dimensions: ["用词", "节奏", "语气"].map((name) => ({
    name,
    score: 60,
    reason: "依据。"
  })),
  similarities: ["短句。"],
  differences: ["意象。"],
  score: 60
};

function completed(
  content: string,
  stopReason?: string
): Extract<AgentRuntimeEvent, { type: "agent.completed" }> {
  return {
    type: "agent.completed",
    runId: "run",
    sessionId: "session",
    payload: {
      messageId: "message",
      content,
      ...(stopReason ? { stopReason } : {}),
      runtime
    }
  };
}

const plan = (task: ExtrasAgentResolvedTask = styleTask) =>
  planExtrasRun({ runId: "run", spec: { sessionId: "session", task } });

describe("extras run plan", () => {
  it("is a one-shot run with the target's identity and no conversation key", () => {
    const current = plan();
    expect(current.agentKey).toBeUndefined();
    expect(current.target).toEqual({ runId: "run", sessionId: "session" });
    expect(current.eventSource).toEqual({ runId: "run", sessionId: "session" });
  });

  it("turns a valid final message into an output event before completion", () => {
    expect(
      plan().completionEvents?.(completed(JSON.stringify(result)))
    ).toMatchObject([
      {
        type: "extras_agent.output_updated",
        payload: {
          agentId: "style-comparison",
          jobId: "job",
          output: { kind: "style-comparison-result", result }
        }
      }
    ]);
  });

  it("replaces an invalid or truncated final message with an error", () => {
    expect(plan().completionEvents?.(completed("相似度很高"))).toMatchObject([
      {
        type: "agent.error",
        payload: {
          code: "extras_agent.invalid_output",
          message: "模型未返回完整的比对结论与有效评分，请重新比对。"
        }
      }
    ]);
    expect(
      plan().completionEvents?.(completed(JSON.stringify(result), "length"))
    ).toMatchObject([
      {
        type: "agent.error",
        payload: { code: "extras_agent.output_truncated" }
      }
    ]);
    expect(plan().completionEvents?.(completed("", "aborted"))).toEqual([]);
  });

  it("leaves tool-submitted agents to their result tools", () => {
    const revision = plan({
      agentId: "revision-analysis",
      profile: {
        id: "default",
        name: "修改分析",
        description: "测试",
        systemPrompt: "学习修改"
      },
      input: {
        jobId: "job",
        beforeText: "甲",
        afterText: "乙",
        changes: [
          {
            id: "c",
            before: "甲",
            after: "乙",
            beforeStart: 0,
            afterStart: 0,
            reason: "",
            coarse: false
          }
        ],
        overallReason: ""
      }
    });
    expect(revision.completionEvents).toBeUndefined();
    expect(() =>
      revision.assertModelBudget?.({
        contextWindow: 8_000,
        maxTokens: 8_000
      } as never)
    ).toThrow("不会被截断");
  });

  it("turns a conversation turn into a cached, history-aware run", () => {
    const history = [
      {
        role: "user" as const,
        content: "你好",
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        role: "assistant" as const,
        content: "你好。",
        createdAt: "2026-01-01T00:00:01.000Z"
      }
    ];
    const current = planExtrasRun({
      runId: "run",
      spec: {
        sessionId: "session",
        task: chatRoleplayTask(),
        conversation: {
          message: "看这张图",
          history,
          historyMode: "replace",
          attachments: [
            {
              id: "image",
              name: "灯塔.png",
              kind: "image",
              mediaType: "image/png",
              size: 4,
              data: "AAAA"
            }
          ]
        }
      }
    });
    expect(current.agentKey).toBe("session:extras:chat-roleplay:character-a");
    expect(current.target).toMatchObject({
      conversationHistory: history,
      conversationHistoryMode: "replace"
    });
    expect(current.completionEvents).toBeUndefined();
    expect(current.userMessageContent(false)).toEqual([
      { type: "text", text: "看这张图\n【用户上传的图片】灯塔.png" },
      { type: "image", data: "AAAA", mimeType: "image/png" }
    ]);
  });

  it("refuses a conversation agent without its turn", () => {
    expect(() =>
      planExtrasRun({
        runId: "run",
        spec: { sessionId: "session", task: chatRoleplayTask() }
      })
    ).toThrow("conversation turn");
  });
});
