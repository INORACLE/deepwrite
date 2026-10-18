import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_ASSISTANT_NORMAL_PROMPT,
  DEFAULT_CHAT_ASSISTANT_PROJECT_PROMPT,
  createDefaultCreativePlotStages,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { ExtrasAgentConfigStore } from "../config-store";
import { resolveExtrasTask } from "../task-resolver";
import type { ChatRuntimeSources } from "./runtime-snapshot";

const NOW = "2026-08-17T08:00:00.000Z";
const temporaryDirectories: string[] = [];

async function createStore(): Promise<{
  path: string;
  store: ExtrasAgentConfigStore;
}> {
  const path = await mkdtemp(join(tmpdir(), "deepwrite-chat-config-"));
  temporaryDirectories.push(path);
  return { path, store: new ExtrasAgentConfigStore(path) };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

const longBook = {
  schemaVersion: 1,
  kind: "deepwrite.long-book",
  id: "longbook_a",
  title: "只读长篇",
  bookType: "long",
  genre: "悬疑",
  status: "editing",
  linkedMaterialIdsByKind: {
    character: [],
    gimmick: [],
    plot: [],
    draft: [],
    other: []
  },
  linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
  navigation: {
    schemaVersion: 1,
    bookId: "longbook_a",
    updatedAt: NOW,
    counts: {
      worldbuildingCategories: 0,
      characters: 0,
      volumes: 1,
      arcs: 0,
      chapterCards: 0,
      committedChapters: 0,
      storyEvents: 0,
      foreshadowingThreads: 0
    },
    worldbuilding: [],
    characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
    characters: [],
    volumes: [{ id: "volume_one", title: "第一卷", order: 1 }],
    arcs: [],
    chapterCards: [],
    committedThroughChapterId: null
  },
  createdAt: NOW,
  updatedAt: NOW
};

/** Read-only Main sources with an empty catalog and one long book. */
function chatSources(requests: string[] = []): ChatRuntimeSources {
  const catalog = {
    schemaVersion: 1,
    revision: 1,
    creativePlotStages: createDefaultCreativePlotStages(),
    books: [],
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    updatedAt: NOW
  };
  const payloads: Record<string, unknown> = {
    "catalog.index": catalog,
    "catalog.snapshot": catalog,
    "long.list": { updatedAt: NOW, books: [longBook] }
  };
  return {
    core: async (command: CommandEnvelope): Promise<CommandResult> => {
      requests.push(command.type);
      return {
        status: "accepted",
        requestId: command.id,
        payload: payloads[command.type]
      };
    },
    listModels: async () => ({ models: [], defaultModelId: "" }),
    queryUsage: async () => ({
      generatedAt: NOW,
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        requestCount: 0
      },
      trendGranularity: "day",
      trend: [],
      models: [],
      modules: [],
      recentCalls: []
    }),
    appVersion: () => "1.2.3"
  };
}

describe("chat agent profiles", () => {
  it("ships the normal persona and the default project prompt", async () => {
    const { store } = await createStore();
    expect((await store.list("chat-normal")).profiles).toMatchObject([
      {
        id: "default",
        systemPrompt: DEFAULT_CHAT_ASSISTANT_NORMAL_PROMPT,
        builtin: true
      }
    ]);
    expect((await store.list("chat-project")).profiles).toMatchObject([
      {
        id: "default",
        systemPrompt: DEFAULT_CHAT_ASSISTANT_PROJECT_PROMPT,
        builtin: true
      }
    ]);
    expect((await store.list("chat-roleplay")).profiles).toEqual([]);
  });

  it("reads roles and project prompts saved before the unified store", async () => {
    const { path, store } = await createStore();
    await writeJson(join(path, "config", "chat-assistant-roleplay.json"), [
      { id: "role-a", name: "守望者", systemPrompt: "你是灯塔守望者。" },
      { id: "role-b", name: "守望者", systemPrompt: "你是另一位守望者。" }
    ]);
    await writeJson(join(path, "config", "chat-assistant-projects.json"), {
      version: 1,
      projects: ["short:book-1", "long:longbook_a", "broken"],
      prompts: { "short:book-1": "优先核对人物动机。" }
    });

    expect(
      (await store.list("chat-roleplay")).profiles.map(({ id }) => id)
    ).toEqual(["role-a", "role-b"]);
    expect((await store.list("chat-project")).profiles).toMatchObject([
      { id: "default", builtin: true },
      {
        id: "short:book-1",
        project: { projectType: "short", projectId: "book-1" },
        systemPrompt: "优先核对人物动机。"
      },
      {
        id: "long:longbook_a",
        project: { projectType: "long", projectId: "longbook_a" },
        systemPrompt: DEFAULT_CHAT_ASSISTANT_PROJECT_PROMPT
      }
    ]);
  });
});

describe("chat task resolution", () => {
  it("grounds a normal chat in Main's redacted app snapshot", async () => {
    const { store } = await createStore();
    const requests: string[] = [];
    const { task, resourceId } = await resolveExtrasTask(
      store,
      chatSources(requests),
      {
        agentId: "chat-normal",
        profileId: "default",
        input: {}
      }
    );
    expect(task).toMatchObject({
      agentId: "chat-normal",
      profile: { systemPrompt: DEFAULT_CHAT_ASSISTANT_NORMAL_PROMPT },
      input: {
        runtime: {
          software: { version: "1.2.3" },
          longBooks: [{ id: "longbook_a" }]
        }
      }
    });
    expect(resourceId).toBeUndefined();
    expect(requests.sort()).toEqual(["catalog.index", "long.list"]);
  });

  it("uses the default prompt for an unconfigured project and binds long books", async () => {
    const { store } = await createStore();
    const { task, resourceId } = await resolveExtrasTask(store, chatSources(), {
      agentId: "chat-project",
      profileId: "long:longbook_a",
      input: { project: { projectType: "long", projectId: "longbook_a" } }
    });
    expect(task).toMatchObject({
      profile: {
        id: "default",
        systemPrompt: DEFAULT_CHAT_ASSISTANT_PROJECT_PROMPT
      },
      input: { runtime: { projectBook: { id: "longbook_a" } } }
    });
    expect(resourceId).toBe("longbook_a");
  });

  it("rejects missing projects and roles with a clear message", async () => {
    const { store } = await createStore();
    await expect(
      resolveExtrasTask(store, chatSources(), {
        agentId: "chat-project",
        profileId: "short:missing",
        input: { project: { projectType: "short", projectId: "missing" } }
      })
    ).rejects.toThrow("所选创作项目不存在");
    await expect(
      resolveExtrasTask(store, chatSources(), {
        agentId: "chat-roleplay",
        profileId: "missing",
        input: {}
      })
    ).rejects.toThrow("所选人物配置不存在");
  });
});
