import { describe, expect, it, vi } from "vitest";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type Context,
  type FauxResponseStep,
  type Model
} from "@earendil-works/pi-ai";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type LibraryAgentWorkspaceSnapshot,
  type SubagentAgentMode
} from "@deepwrite/contracts";
import { scriptAgentProfile, screenplayWorkspace } from "../index.test-support";
import {
  profile as longProfile,
  workspace as longWorkspace
} from "../long-agent-tools.test-support";
import { buildRunTools } from "../run-tools";
import type { AgentRunInput } from "../runtime-types";
import {
  shortProfile,
  shortWorkspace
} from "../short-agent-tools.test-support";
import { inspectTranscript } from "../transcript.test-support";
import { WEB_SEARCH_PROMPT } from "./prompt";
import { runtimeConfig } from "./test-support";

const contextOf = (searching: boolean) =>
  searching ? { webSearch: runtimeConfig({ perRunCallLimit: 2 }) } : {};

const libraryWorkspace: LibraryAgentWorkspaceSnapshot = {
  domain: "material",
  libraryId: "materials",
  title: "情节素材库",
  kind: "plot",
  libraryType: "short",
  readOnly: false,
  projectRevision: 1,
  overview: "情节参考",
  overviewDocumentId: "overview",
  overviewRevision: createShortWorkspaceContentRevision("情节参考"),
  entries: []
};

function member(agentMode: SubagentAgentMode) {
  return {
    id: `member_${agentMode.replace("-", "_")}`,
    name: `成员-${agentMode}`,
    description: "测试成员",
    systemPrompt: "完成委派。",
    enabled: true,
    agentMode,
    modelMode: "inherit" as const
  };
}

function harness(
  responses: FauxResponseStep[] = [fauxAssistantMessage("完成")]
) {
  const faux = fauxProvider({
    api: `mounting-${Math.random()}`,
    provider: `mounting-${Math.random()}`,
    tokensPerSecond: 0,
    models: [{ id: "test-model", name: "Test", reasoning: true }]
  });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const contexts: Context[] = [];
  const streamFn: StreamFn = (model, context, options) => {
    contexts.push(inspectTranscript(context));
    return models.streamSimple(model, context, options);
  };
  return {
    contexts,
    streamFn,
    model: faux.getModel("test-model") as Model<Api>
  };
}

function options(
  runtime: ReturnType<typeof harness>,
  mode: "provider" | "local-faux" = "provider"
) {
  return {
    ...runtime,
    parentRuntime: { provider: "test", model: "test-model", mode },
    thinkingLevel: "off" as const,
    toolExecutionHooks: {},
    requestUserInput: vi.fn(),
    getParentMessages: () => [],
    portableToolSchemaProfile: "writing-workspace" as const
  };
}

const names = (tools: readonly Pick<AgentTool, "name">[]) =>
  tools.map(({ name }) => name);
const SEARCH = "web_search";

function mainInputs(searching: boolean): Record<string, AgentRunInput> {
  const base = { sessionId: "session", runId: "run", prompt: "你好" };
  return {
    短篇: {
      ...base,
      agentProfile: shortProfile(),
      workspaceContext: { shortWorkspace: shortWorkspace() },
      ...contextOf(searching)
    },
    剧本: {
      ...base,
      scriptAgentProfile: scriptAgentProfile(),
      workspaceContext: { scriptWorkspace: screenplayWorkspace() },
      ...contextOf(searching)
    },
    长篇: {
      ...base,
      longAgentProfile: longProfile("long"),
      workspaceContext: { longWorkspace: longWorkspace("long", "plot_design") },
      ...contextOf(searching)
    },
    素材库: {
      ...base,
      libraryAgentProfile: DEFAULT_LIBRARY_AGENT_PROFILES.find(
        (entry) => entry.domain === "material"
      )!,
      workspaceContext: { libraryWorkspace },
      ...contextOf(searching)
    },
    技能库: {
      ...base,
      libraryAgentProfile: DEFAULT_LIBRARY_AGENT_PROFILES.find(
        (entry) => entry.domain === "skill"
      )!,
      workspaceContext: {
        libraryWorkspace: {
          ...libraryWorkspace,
          domain: "skill",
          kind: "general",
          entries: []
        }
      },
      ...contextOf(searching)
    },
    技能转子智能体编写: {
      ...base,
      workspaceContext: {
        subagentAuthoring: {
          parentAgentId: "script",
          parentAgentLabel: "剧本",
          outputMode: "handoff",
          skills: [],
          existingSubagentNames: []
        }
      },
      ...contextOf(searching)
    } as AgentRunInput
  };
}

describe("web_search in the main agent's tools", () => {
  for (const [label, searching] of [
    ["", true],
    ["不", false]
  ] as const) {
    it.each(Object.keys(mainInputs(true)))(
      `${label}挂载到%s主智能体：设置${searching ? "已" : "未"}启用`,
      (kind) => {
        const tools = buildRunTools(
          mainInputs(searching)[kind]!,
          options(harness())
        );
        expect(names(tools).includes(SEARCH)).toBe(searching);
        expect(names(tools).filter((name) => name === SEARCH).length).toBe(
          searching ? 1 : 0
        );
      }
    );
  }
});

describe("web_search in subagents", () => {
  function shortRun(searching: boolean): AgentRunInput {
    return {
      ...mainInputs(searching).短篇!,
      subagentDefinitions: (
        ["standard", "pure-read", "pure-bare"] as SubagentAgentMode[]
      ).map(member)
    };
  }

  async function runChild(
    input: AgentRunInput,
    mode: SubagentAgentMode,
    responses?: FauxResponseStep[]
  ) {
    const runtime = harness(responses);
    const spawn = buildRunTools(input, options(runtime)).find(
      (tool) => tool.name === "spawn_subagent"
    )!;
    await spawn.execute("call", {
      tasks: [{ subagent_id: member(mode).id, task: "处理这一段" }]
    } as never);
    return runtime.contexts[0]!;
  }

  it.each([
    ["standard", true],
    ["pure-read", true],
    ["pure-bare", false]
  ] as const)("%s child %s the tool and its rules", async (mode, gets) => {
    const withSearch = await runChild(shortRun(true), mode);
    const childTools = (withSearch.tools ?? []).map(({ name }) => name);
    expect(childTools.includes(SEARCH)).toBe(gets);
    expect(withSearch.systemPrompt?.includes(WEB_SEARCH_PROMPT)).toBe(gets);
    if (mode === "pure-read")
      expect(childTools.sort()).toEqual([
        "query_linked_material_entries",
        "read",
        SEARCH
      ]);
    const without = await runChild(shortRun(false), mode);
    expect(names(without.tools ?? [])).not.toContain(SEARCH);
    expect(without.systemPrompt).not.toContain("【联网搜索】");
  });

  it("tells a pure-read child it may look things up when it can", async () => {
    const context = await runChild(shortRun(true), "pure-read");
    expect(context.systemPrompt).toContain("web_search 查证公开资料");
    const plain = await runChild(shortRun(false), "pure-read");
    expect(plain.systemPrompt).not.toContain("web_search");
  });

  it("shares one search budget between the main agent and its children", async () => {
    const runtime = harness([
      fauxAssistantMessage(fauxToolCall(SEARCH, { query: "子任务查证" }), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage("子任务完成")
    ]);
    const tools = buildRunTools(shortRun(true), options(runtime, "local-faux"));
    const search = tools.find((tool) => tool.name === SEARCH)!;
    const spawn = tools.find((tool) => tool.name === "spawn_subagent")!;
    await search.execute("one", { query: "主智能体先查" } as never);
    await spawn.execute("call", {
      tasks: [{ subagent_id: member("standard").id, task: "查一下" }]
    } as never);
    await expect(
      search.execute("three", { query: "主智能体再查" } as never)
    ).rejects.toThrow("本轮联网搜索已达上限（2 次）");
  });
});

describe("web_search in library management children", () => {
  it("lets a manager search and states the rules once", async () => {
    const run: AgentRunInput = {
      ...mainInputs(true).短篇!,
      libraryManagement: {
        scope: { bookId: "book", bookType: "short" },
        libraries: [
          {
            domain: "material",
            libraryId: "materials",
            title: "情节素材库",
            readOnly: false
          }
        ],
        managers: DEFAULT_LIBRARY_AGENT_PROFILES.map((profile) => ({
          domain: profile.domain,
          description: "管理已确认的资料",
          profile
        }))
      },
      libraryManagementCommandExecutor: vi.fn(async () => ({
        status: "accepted" as const,
        requestId: "query",
        payload: { libraries: [], workspace: libraryWorkspace }
      }))
    };
    const runtime = harness();
    const spawn = buildRunTools(run, options(runtime)).find(
      (tool) => tool.name === "spawn_subagent"
    )!;
    await spawn.execute("call", {
      subagent_id: "builtin:material-manager",
      library_id: "materials",
      task: "按用户要求记录情节"
    } as never);
    const child = runtime.contexts[0]!;
    expect(names(child.tools ?? [])).toContain(SEARCH);
    const occurrences = child.systemPrompt!.split("【联网搜索】").length - 1;
    expect(occurrences).toBe(1);
  });
});
