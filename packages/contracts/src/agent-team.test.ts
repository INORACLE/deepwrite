import { describe, expect, it } from "vitest";
import {
  AgentPromptCommandPayloadSchema,
  AgentTeamSettingsInputSchema,
  CommandEnvelopeSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  LongAgentTeamSettingsSchema,
  ScriptAgentTeamSettingsSchema,
  SubagentActivityEventEnvelopeSchema,
  SubagentCompletedPayloadSchema,
  SubagentPlannedEventEnvelopeSchema,
  SubagentPlannedPayloadSchema,
  SubagentStartedPayloadSchema,
  SUBAGENT_TASK_BATCH_MAX_COUNT,
  ShortAgentSubagentDefinitionSchema,
  subagentWebSearchAllowed,
  subagentsNeedWebSearch,
  createEnvelope,
  createDefaultCreativePlotStages,
  createShortWorkspaceContentRevision,
  type ShortAgentSubagentDefinition
} from "./index";

const definition: ShortAgentSubagentDefinition = {
  id: "continuity_reviewer",
  name: "连续性审阅",
  description: "检查人物状态、时间线和伏笔是否前后一致。",
  systemPrompt: "只检查连续性问题，并把结论摘要交还主智能体。",
  enabled: true,
  agentMode: "standard",
  modelMode: "inherit"
};

function completeSettings() {
  return {
    workspaceType: "short" as const,
    teams: DEFAULT_AGENT_TEAM_SETTINGS.teams.map((team) => ({
      parentAgentId: team.parentAgentId,
      subagents: [{ ...definition }]
    }))
  };
}

function shortWorkspace() {
  const revision = createShortWorkspaceContentRevision("");
  return {
    id: "book-1",
    title: "雨夜来信",
    categories: ["悬疑"],
    activeStageId: "outline" as const,
    plotStages: createDefaultCreativePlotStages(),
    expertDraft: {
      id: "draft" as const,
      title: "正文",
      revision,
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "1000 字",
          body: {
            documentId: "draft:section-1:body",
            title: "第一节",
            content: "",
            revision
          },
          characterState: {
            documentId: "draft:section-1:character-state",
            title: "第一节 · 人物状态",
            content: "",
            revision
          }
        }
      ]
    },
    stages: [
      "character_design",
      ...createDefaultCreativePlotStages().map(({ id }) => id)
    ].map((stageId) => ({
      stageId,
      title: stageId,
      content: "",
      revision
    }))
  };
}

describe("agent-team contracts", () => {
  it("accepts the single-team short workspace shape", () => {
    expect(AgentTeamSettingsInputSchema.parse(completeSettings())).toEqual({
      ...completeSettings(),
      parallelSubagents: false
    });
  });

  it("keeps the team-wide parallel switch and defaults older settings to off", () => {
    expect(
      AgentTeamSettingsInputSchema.parse({
        ...completeSettings(),
        parallelSubagents: true
      }).parallelSubagents
    ).toBe(true);
    expect(
      ScriptAgentTeamSettingsSchema.parse({
        workspaceType: "script",
        teams: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS.teams
      }).parallelSubagents
    ).toBe(false);
    expect(
      LongAgentTeamSettingsSchema.parse({
        workspaceType: "long",
        parallelSubagents: true,
        teams: DEFAULT_LONG_AGENT_TEAM_SETTINGS.teams
      }).parallelSubagents
    ).toBe(true);
    expect(
      AgentTeamSettingsInputSchema.safeParse({
        ...completeSettings(),
        parallelSubagents: "yes"
      }).success
    ).toBe(false);
  });

  it("defaults missing modelMode to inherit and requires modelId for custom", () => {
    const legacy = completeSettings();
    legacy.teams[0]!.subagents = [
      {
        id: "legacy_helper",
        name: "旧配置助手",
        description: "无模型字段的旧数据。",
        systemPrompt: "保持兼容。",
        enabled: true
      } as ShortAgentSubagentDefinition
    ];
    const parsed = AgentTeamSettingsInputSchema.parse(legacy);
    expect(parsed.teams[0]?.subagents[0]).toMatchObject({
      modelMode: "inherit"
    });

    const customMissingModel = completeSettings();
    customMissingModel.teams[0]!.subagents = [
      {
        ...definition,
        modelMode: "custom"
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customMissingModel).success
    ).toBe(false);

    const customWithModel = completeSettings();
    customWithModel.teams[0]!.subagents = [
      {
        ...definition,
        modelMode: "custom",
        modelId: "model-local-1",
        thinkingLevel: "medium"
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customWithModel).success
    ).toBe(true);

    const customOffWithoutTemperature = completeSettings();
    customOffWithoutTemperature.teams[0]!.subagents = [
      {
        ...definition,
        modelMode: "custom",
        modelId: "model-local-1",
        thinkingLevel: "off"
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customOffWithoutTemperature)
        .success
    ).toBe(false);

    const customOffWithTemperature = completeSettings();
    customOffWithTemperature.teams[0]!.subagents = [
      {
        ...definition,
        modelMode: "custom",
        modelId: "model-local-1",
        thinkingLevel: "off",
        temperature: 0.7
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customOffWithTemperature).success
    ).toBe(true);
  });

  it("defaults missing agentMode to standard and accepts the pure modes", () => {
    const { agentMode: _omitted, ...withoutMode } = definition;
    const legacy = completeSettings();
    legacy.teams[0]!.subagents = [withoutMode as ShortAgentSubagentDefinition];
    expect(
      AgentTeamSettingsInputSchema.parse(legacy).teams[0]?.subagents[0]
        ?.agentMode
    ).toBe("standard");

    for (const agentMode of ["pure-read", "pure-bare"] as const) {
      const pure = completeSettings();
      pure.teams[0]!.subagents = [{ ...definition, agentMode }];
      expect(
        AgentTeamSettingsInputSchema.parse(pure).teams[0]?.subagents[0]
          ?.agentMode
      ).toBe(agentMode);
    }

    const unknown = completeSettings();
    unknown.teams[0]!.subagents = [
      { ...definition, agentMode: "sandbox" as never }
    ];
    expect(AgentTeamSettingsInputSchema.safeParse(unknown).success).toBe(false);
  });

  it("rejects duplicate ids and names inside one parent team", () => {
    const duplicate = completeSettings();
    duplicate.teams[0]!.subagents = [
      { ...definition },
      { ...definition, id: "other", name: definition.name.toUpperCase() }
    ];

    const result = AgentTeamSettingsInputSchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.at(-1))).toContain(
        "name"
      );
    }
  });

  it("keeps subagent definitions internal to agent.prompt", () => {
    const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        sessionId: "session-1",
        message: "审阅大纲",
        workspaceContext: { shortWorkspace: shortWorkspace() },
        agentProfile: profile,
        subagentDefinitions: [definition]
      }).success
    ).toBe(true);
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        sessionId: "session-1",
        message: "审阅大纲",
        subagentDefinitions: [definition]
      }).success
    ).toBe(false);
  });

  it("allows the parallel flag only alongside subagent definitions", () => {
    const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
    const payload = {
      sessionId: "session-1",
      message: "并行写两节",
      workspaceContext: { shortWorkspace: shortWorkspace() },
      agentProfile: profile
    };
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        ...payload,
        subagentDefinitions: [definition],
        parallelSubagents: true
      }).success
    ).toBe(true);
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        ...payload,
        parallelSubagents: true
      }).success
    ).toBe(false);
  });

  it("carries batch task identity and the skipped status on subagent events", () => {
    const base = {
      sessionId: "session-1",
      runId: "run-1",
      parentToolCallId: "call-1",
      subagentRunId: "subrun-2",
      subagentId: "continuity_reviewer",
      name: "连续性审阅",
      runtime: { provider: "faux", model: "faux", mode: "local-faux" as const },
      batchTask: { index: 1, key: "review", dependsOn: ["c3"] }
    };
    expect(
      SubagentStartedPayloadSchema.safeParse({ ...base, task: "检查衔接" })
        .success
    ).toBe(true);
    expect(
      SubagentCompletedPayloadSchema.safeParse({
        ...base,
        status: "skipped",
        summary: "前置任务 c3 没有完成，该子任务已跳过。"
      }).success
    ).toBe(true);
    expect(
      SubagentStartedPayloadSchema.safeParse({
        ...base,
        task: "检查衔接",
        batchTask: {
          index: SUBAGENT_TASK_BATCH_MAX_COUNT,
          key: "review",
          dependsOn: []
        }
      }).success
    ).toBe(false);
    const planned = {
      index: 1,
      key: "review",
      dependsOn: ["c3"],
      subagentId: "continuity_reviewer",
      name: "连续性审阅",
      task: "检查衔接",
      runtime: base.runtime
    };
    expect(
      SubagentPlannedEventEnvelopeSchema.safeParse(
        createEnvelope(
          "subagent.planned",
          {
            sessionId: "session-1",
            runId: "run-1",
            parentToolCallId: "call-1",
            tasks: [planned]
          },
          {
            id: "evt-planned",
            context: { sessionId: "session-1", runId: "run-1" }
          }
        )
      ).success
    ).toBe(true);
    expect(
      SubagentPlannedPayloadSchema.safeParse({
        sessionId: "session-1",
        runId: "run-1",
        parentToolCallId: "call-1",
        tasks: [{ ...planned, name: "" }]
      }).success
    ).toBe(false);
  });

  it("allows 60 short, script, and long subagents and rejects exceeding the limit", () => {
    const definitions = Array.from({ length: 60 }, (_, index) => ({
      ...definition,
      id: `helper_${index + 1}`,
      name: `助手 ${index + 1}`
    }));
    expect(
      AgentTeamSettingsInputSchema.safeParse({
        workspaceType: "short",
        teams: [{ parentAgentId: "short", subagents: definitions }]
      }).success
    ).toBe(true);

    const script = structuredClone(DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS);
    script.teams[0]!.subagents = definitions;
    expect(ScriptAgentTeamSettingsSchema.safeParse(script).success).toBe(true);
    script.teams[0]!.subagents = [
      ...definitions,
      { ...definition, id: "helper_61", name: "助手 61" }
    ];
    expect(ScriptAgentTeamSettingsSchema.safeParse(script).success).toBe(false);

    const long = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    long.teams[0]!.subagents = definitions;
    expect(LongAgentTeamSettingsSchema.safeParse(long).success).toBe(true);
    long.teams[0]!.subagents = [
      ...definitions,
      { ...definition, id: "helper_61", name: "助手 61" }
    ];
    expect(LongAgentTeamSettingsSchema.safeParse(long).success).toBe(false);
  });

  it("registers agentTeams commands and validates subagent event parent identity", () => {
    const command = createEnvelope("agentTeams.list", {}, { id: "cmd-1" });
    expect(CommandEnvelopeSchema.safeParse(command).success).toBe(true);

    const event = createEnvelope(
      "subagent.activity",
      {
        sessionId: "session-1",
        runId: "run-1",
        parentToolCallId: "tool-parent",
        subagentRunId: "sub-run-1",
        subagentId: definition.id,
        name: definition.name,
        runtime: {
          provider: "local",
          model: "test",
          mode: "local-faux" as const
        },
        activity: { type: "message_delta" as const, delta: "完成" }
      },
      {
        id: "evt-1",
        context: { sessionId: "session-1", runId: "wrong-run" }
      }
    );
    expect(SubagentActivityEventEnvelopeSchema.safeParse(event).success).toBe(
      false
    );
  });
});

describe("subagent web search mode", () => {
  const parse = (extra: Record<string, unknown>) =>
    ShortAgentSubagentDefinitionSchema.safeParse({ ...definition, ...extra });

  it("accepts the three modes and treats a missing one as following the main agent", () => {
    for (const webSearchMode of ["inherit", "on", "off"])
      expect(parse({ webSearchMode })).toMatchObject({
        success: true,
        data: { webSearchMode }
      });
    const older = parse({});
    expect(older.success).toBe(true);
    expect(older.data).not.toHaveProperty("webSearchMode");
    expect(parse({ webSearchMode: "always" }).success).toBe(false);
  });

  it("allows search by mode: inherit follows the main agent, on and off do not", () => {
    for (const main of [true, false]) {
      expect(subagentWebSearchAllowed(undefined, main)).toBe(main);
      expect(subagentWebSearchAllowed("inherit", main)).toBe(main);
      expect(subagentWebSearchAllowed("on", main)).toBe(true);
      expect(subagentWebSearchAllowed("off", main)).toBe(false);
    }
  });

  it("asks for search on its own only for an always-on member with tools", () => {
    expect(subagentsNeedWebSearch(undefined)).toBe(false);
    expect(subagentsNeedWebSearch([])).toBe(false);
    expect(
      subagentsNeedWebSearch([
        { webSearchMode: "inherit" },
        { webSearchMode: "off" },
        {}
      ])
    ).toBe(false);
    expect(subagentsNeedWebSearch([{}, { webSearchMode: "on" }])).toBe(true);
    expect(
      subagentsNeedWebSearch([{ webSearchMode: "on", agentMode: "pure-read" }])
    ).toBe(true);
    expect(
      subagentsNeedWebSearch([{ webSearchMode: "on", agentMode: "pure-bare" }])
    ).toBe(false);
  });
});
