import {
  CHAT_ASSISTANT_ROLEPLAY_PROMPT_SUFFIX,
  DEFAULT_CHAT_ASSISTANT_NORMAL_PROMPT,
  createDefaultCreativePlotStages,
  type ChatAssistantProjectRuntimeSnapshot,
  type ChatAssistantRuntimeSnapshot,
  type ExtrasAgentResolvedTaskOf
} from "@deepwrite/contracts";

export const NOW = "2026-08-17T08:00:00.000Z";
export { CHAT_ASSISTANT_ROLEPLAY_PROMPT_SUFFIX };

function dashboard() {
  return {
    generatedAt: NOW,
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      requestCount: 0
    },
    trendGranularity: "day" as const,
    trend: [],
    models: [],
    modules: [],
    recentCalls: []
  };
}

export function chatRuntime(): ChatAssistantRuntimeSnapshot {
  const usage = dashboard();
  return {
    software: {
      name: "DeepWrite",
      version: "1.0.0",
      platform: "darwin",
      arch: "arm64",
      currentTime: NOW,
      timezone: "Asia/Shanghai"
    },
    catalog: {
      schemaVersion: 1,
      revision: 1,
      creativePlotStages: createDefaultCreativePlotStages(),
      books: [],
      materials: [],
      materialGroups: [],
      skills: [],
      skillGroups: [],
      updatedAt: NOW
    },
    longBooks: [],
    models: [
      {
        id: "model-1",
        label: "测试模型",
        provider: "example",
        modelId: "example-chat",
        api: "openai-completions",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["off"],
        temperatureOptions: [0.7],
        credentialConfigured: true
      }
    ],
    defaultModelId: "model-1",
    usage: { today: usage, "7d": usage, "30d": usage, all: usage }
  } as unknown as ChatAssistantRuntimeSnapshot;
}

export function shortProjectRuntime(): ChatAssistantProjectRuntimeSnapshot {
  const document = (id: string, title: string, content: string) => ({
    id,
    title,
    content,
    createdAt: NOW,
    updatedAt: NOW
  });
  const projectBook = {
    id: "short-a",
    title: "只读短篇",
    bookType: "short" as const,
    genre: "悬疑",
    status: "editing" as const,
    linkedMaterialIdsByKind: {},
    linkedSkillIdsByKind: {},
    characterStructure: {
      format: "list" as const,
      items: [{ id: "character-alice", title: "林岚", order: 1 }]
    },
    plotStages: [{ id: "outline", title: "大纲", enabled: true, order: 1 }],
    documents: [
      document("outline", "大纲", "林岚在雨夜发现线索。"),
      document("character-alice", "林岚", "林岚是一名调查员。")
    ],
    draft: {
      id: "draft",
      title: "正文",
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "1000 字",
          body: document("draft:section-1:body", "第一节", "雨落在旧码头。"),
          characterState: document(
            "draft:section-1:state",
            "人物状态",
            "林岚保持警觉。"
          ),
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      createdAt: NOW,
      updatedAt: NOW
    },
    createdAt: NOW,
    updatedAt: NOW
  };
  return {
    ...chatRuntime(),
    projectBook
  } as unknown as ChatAssistantProjectRuntimeSnapshot;
}

export function longProjectRuntime(): ChatAssistantProjectRuntimeSnapshot {
  const projectBook = {
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: "long-a",
    title: "只读长篇",
    bookType: "long",
    genre: "悬疑",
    status: "editing",
    linkedMaterialIdsByKind: {},
    linkedSkillIdsByKind: {},
    navigation: {
      schemaVersion: 1,
      bookId: "long-a",
      updatedAt: NOW,
      counts: {
        worldbuildingCategories: 0,
        characters: 0,
        volumes: 1,
        arcs: 0,
        chapterCards: 0,
        committedChapters: 0
      },
      worldbuilding: [],
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characters: [],
      volumes: [{ id: "volume-1", title: "第一卷", order: 1 }],
      arcs: [],
      chapterCards: [],
      committedThroughChapterId: null
    },
    createdAt: NOW,
    updatedAt: NOW
  };
  return {
    ...chatRuntime(),
    longBooks: [projectBook],
    projectBook
  } as unknown as ChatAssistantProjectRuntimeSnapshot;
}

export function chatNormalTask(): ExtrasAgentResolvedTaskOf<"chat-normal"> {
  return {
    agentId: "chat-normal",
    profile: {
      id: "default",
      name: "普通聊天",
      description: "测试",
      systemPrompt: DEFAULT_CHAT_ASSISTANT_NORMAL_PROMPT
    },
    input: { runtime: chatRuntime() }
  };
}

export function chatProjectTask(
  runtime: ChatAssistantProjectRuntimeSnapshot = shortProjectRuntime()
): ExtrasAgentResolvedTaskOf<"chat-project"> {
  const project = {
    projectType: runtime.projectBook.bookType,
    projectId: runtime.projectBook.id
  };
  return {
    agentId: "chat-project",
    profile: {
      id: `${project.projectType}:${project.projectId}`,
      name: runtime.projectBook.title,
      project,
      systemPrompt: "优先核对人物动机。"
    },
    input: { project, runtime }
  };
}

export function chatRoleplayTask(
  id = "character-a",
  systemPrompt = "你是住在海边的灯塔守望者。"
): ExtrasAgentResolvedTaskOf<"chat-roleplay"> {
  return {
    agentId: "chat-roleplay",
    profile: { id, name: id, systemPrompt },
    input: {}
  };
}

/** The cached conversation agents of an adapter, for state assertions. */
export function cachedAgents(runtime: object) {
  return (
    runtime as {
      conversationAgents: Map<
        string,
        {
          state: {
            systemPrompt: string;
            tools: Array<{ name: string }>;
            messages: Array<{ role: string; content: unknown }>;
          };
        }
      >;
    }
  ).conversationAgents;
}
