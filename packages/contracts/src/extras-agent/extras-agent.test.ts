import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, createEnvelope } from "../index";
import { SystemEventEnvelopeSchema } from "../system";
import { WorkspaceRuntimeContextSchema } from "../session/runtime";
import { assertExtrasAgentBudget } from "./budget";
import { ExtrasAgentSettingsInputSchema } from "./profiles";
import {
  EXTRAS_AGENT_IDS,
  EXTRAS_WEB_SEARCH_AGENT_IDS,
  extrasAgentUsesWebSearch
} from "./ids";
import {
  ExtrasAgentResolvedTaskSchema,
  ExtrasAgentRunRequestSchema
} from "./tasks";

const book = {
  id: "book-1",
  title: "测试短篇",
  text: "完整正文",
  kind: "paste" as const,
  importedAt: "2026-01-01T00:00:00.000Z"
};
const shortProfile = {
  id: "preset",
  name: "剧情",
  description: "测试",
  systemPrompt: "分析全文",
  selectionMode: "single" as const,
  output: {
    domain: "material" as const,
    kind: "plot" as const,
    stageId: "pacing" as const
  }
};
const shortTask = (books = [book]) => ({
  agentId: "short-book-analysis" as const,
  profileId: shortProfile.id,
  input: { jobId: "job", books }
});
const style = {
  jobId: "job",
  referenceText: "雨停了。",
  comparisonText: "风停了。"
};

describe("extras agent run protocol", () => {
  it("routes a task by agent id and validates the agent's own input", () => {
    expect(
      ExtrasAgentRunRequestSchema.safeParse({
        sessionId: "session",
        task: shortTask()
      }).success
    ).toBe(true);
    expect(
      ExtrasAgentRunRequestSchema.safeParse({
        sessionId: "session",
        task: shortTask(
          Array.from({ length: 11 }, (_, i) => ({ ...book, id: `b-${i}` }))
        )
      }).success
    ).toBe(false);
    expect(
      ExtrasAgentRunRequestSchema.safeParse({
        sessionId: "session",
        task: { ...shortTask(), agentId: "learning-imitation" }
      }).success
    ).toBe(false);
  });

  it("binds the run envelope to its session", () => {
    const payload = { sessionId: "session", task: shortTask() };
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope("extrasAgent.run", payload, {
          id: "cmd",
          context: { correlationId: "cmd", sessionId: "session" }
        })
      ).success
    ).toBe(true);
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope("extrasAgent.run", payload, {
          id: "cmd",
          context: { correlationId: "cmd", sessionId: "other" }
        })
      ).success
    ).toBe(false);
  });

  it("no longer carries extras inputs through the creation-space context", () => {
    const parsed = WorkspaceRuntimeContextSchema.parse({
      shortBookAnalysis: shortTask().input,
      styleComparison: style
    });
    expect(parsed).toEqual({});
  });

  it("publishes one validated output event shape for every agent", () => {
    const event = (output: unknown) =>
      SystemEventEnvelopeSchema.safeParse(
        createEnvelope(
          "extras_agent.output_updated",
          {
            sessionId: "session",
            runId: "run",
            agentId: "style-comparison",
            jobId: "job",
            output,
            runtime: { provider: "test", model: "test", mode: "provider" }
          },
          {
            id: "evt",
            context: { correlationId: "c", sessionId: "session", runId: "run" }
          }
        )
      ).success;
    expect(
      event({
        kind: "book-analysis-note",
        unitId: "unit",
        note: { text: "笔记" }
      })
    ).toBe(true);
    expect(event({ kind: "learning-imitation", result: {} })).toBe(false);
  });
});

describe("extras agent profiles and budget", () => {
  it("rejects duplicate profiles and keeps each agent's prompt rules", () => {
    expect(
      ExtrasAgentSettingsInputSchema.safeParse({
        agentId: "short-book-analysis",
        profiles: [shortProfile, { ...shortProfile, id: "copy" }]
      }).success
    ).toBe(false);
    const prompt = (agentId: string, systemPrompt: string) =>
      ExtrasAgentSettingsInputSchema.safeParse({
        agentId,
        profiles: [
          { id: "default", name: "方法", description: "测试", systemPrompt }
        ]
      }).success;
    expect(prompt("style-comparison", "")).toBe(true);
    expect(prompt("revision-analysis", " ")).toBe(false);
  });

  it("checks budgets against the resolved profile and requires a model where needed", () => {
    const task = ExtrasAgentResolvedTaskSchema.parse({
      agentId: "short-book-analysis",
      profile: shortProfile,
      input: shortTask([book, { ...book, id: "book-2" }]).input
    });
    expect(() =>
      assertExtrasAgentBudget(task, { contextWindow: 100_000 })
    ).toThrow("一本");
    expect(() =>
      assertExtrasAgentBudget(
        {
          agentId: "short-book-analysis",
          profile: shortProfile,
          input: shortTask().input
        },
        undefined
      )
    ).toThrow("请选择可用模型");
    expect(() =>
      assertExtrasAgentBudget(
        {
          agentId: "style-comparison",
          profile: {
            id: "default",
            name: "方法",
            description: "测试",
            systemPrompt: ""
          },
          input: style
        },
        undefined
      )
    ).not.toThrow();
  });
});

describe("extras chat agents", () => {
  const request = (task: unknown, conversation?: unknown) =>
    ExtrasAgentRunRequestSchema.safeParse({
      sessionId: "session",
      task,
      ...(conversation ? { conversation } : {})
    }).success;
  const turn = { message: "你好" };
  const project = { projectType: "long" as const, projectId: "book-1" };

  it("requires a conversation turn for chat agents and only for them", () => {
    const normal = { agentId: "chat-normal", profileId: "default", input: {} };
    expect(request(normal, turn)).toBe(true);
    expect(request(normal)).toBe(false);
    expect(request(shortTask(), turn)).toBe(false);
    // The user's switch rides in the input; the settings never do.
    expect(
      request({ ...normal, input: { webSearchEnabled: true } }, turn)
    ).toBe(true);
    expect(
      request(
        { ...normal, input: { webSearch: { apiKey: "invalid-forged-key" } } },
        turn
      )
    ).toBe(false);
  });

  it("offers search to the two read-only chats only", () => {
    expect([...EXTRAS_WEB_SEARCH_AGENT_IDS]).toEqual([
      "chat-normal",
      "chat-project"
    ]);
    for (const id of EXTRAS_AGENT_IDS)
      expect(extrasAgentUsesWebSearch(id)).toBe(
        id === "chat-normal" || id === "chat-project"
      );
    expect(extrasAgentUsesWebSearch("chat-roleplay")).toBe(false);
  });

  it("binds a project chat to its project's profile and keeps roleplay tool-free", () => {
    const projectTask = {
      agentId: "chat-project",
      profileId: "long:book-1",
      input: { project }
    };
    expect(request(projectTask, turn)).toBe(true);
    expect(request({ ...projectTask, profileId: "long:other" }, turn)).toBe(
      false
    );
    const roleplay = { agentId: "chat-roleplay", profileId: "role", input: {} };
    expect(request(roleplay, turn)).toBe(true);
    expect(
      request({ ...roleplay, input: { webSearchEnabled: true } }, turn)
    ).toBe(false);
  });

  it("lets roles and projects share names but keeps project ids consistent", () => {
    const save = (agentId: string, profiles: unknown[]) =>
      ExtrasAgentSettingsInputSchema.safeParse({ agentId, profiles }).success;
    const role = (id: string) => ({
      id,
      name: "灯塔守望者",
      systemPrompt: "你是守望者。"
    });
    expect(save("chat-roleplay", [role("a"), role("b")])).toBe(true);
    expect(save("chat-roleplay", [role("a"), role("a")])).toBe(false);
    const projectProfile = {
      id: "long:book-1",
      name: "长篇",
      project,
      systemPrompt: "先核对连续性。"
    };
    expect(save("chat-project", [projectProfile])).toBe(true);
    expect(
      save("chat-project", [{ ...projectProfile, id: "short:book-1" }])
    ).toBe(false);
    expect(
      save("chat-project", [
        { id: "default", name: "默认", systemPrompt: "默认提示词。" }
      ])
    ).toBe(true);
  });

  it("checks that a resolved project snapshot matches its project", () => {
    const resolved = (projectBook: unknown) =>
      ExtrasAgentResolvedTaskSchema.safeParse({
        agentId: "chat-project",
        profile: { id: "default", name: "默认", systemPrompt: "默认提示词。" },
        input: { project, runtime: { projectBook } }
      }).success;
    expect(resolved({ id: "book-1", bookType: "long" })).toBe(true);
    expect(resolved({ id: "book-2", bookType: "long" })).toBe(false);
  });
});
