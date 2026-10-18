import { afterEach, it, expect, vi } from "vitest";
import { effectScope } from "vue";
import type {
  DeepWriteApi,
  ExtrasAgentRunRequest,
  ModelConfig,
  ShortBookAnalysisPreset,
  ShortBookAnalysisSource
} from "@deepwrite/contracts/renderer";
import {
  createExtrasAgentsFake,
  outputEvent,
  runEvent
} from "../agent-runtime/extrasAgent.test-support";
import { useShortBookAnalysis } from "./useShortBookAnalysis";
const preset: ShortBookAnalysisPreset = {
  id: "preset",
  name: "分析",
  description: "测试",
  systemPrompt: "分析",
  selectionMode: "multiple",
  output: { domain: "material", kind: "plot", stageId: "pacing" }
};
const single: ShortBookAnalysisPreset = {
  ...preset,
  id: "single",
  name: "单本",
  selectionMode: "single"
};
const skill: ShortBookAnalysisPreset = {
  ...preset,
  id: "skill",
  name: "技能分析",
  output: { domain: "skill", kind: "general", stageId: "outline" }
};
const model = {
  id: "model",
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["off"],
  contextWindow: 100000,
  maxTokens: 16000
} as ModelConfig;
const book = (i: number): ShortBookAnalysisSource => ({
  id: `book-${i}`,
  title: `测试${i}`,
  text: "完整正文",
  kind: "paste",
  importedAt: "2026-01-01T00:00:00.000Z"
});
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function analysisFixture(presets: ShortBookAnalysisPreset[] = [preset]) {
  const scope = effectScope();
  const createLibraryEntry = vi.fn(async () => ({}));
  const fake = createExtrasAgentsFake({ "short-book-analysis": presets });
  const abort = vi.fn(async () => ({}));
  const remove = vi.fn(async (id: string) => id);
  const api = {
    catalog: { createLibraryEntry },
    extrasAgents: fake.extrasAgents,
    session: { abort },
    shortBookAnalysis: { sources: { delete: remove } }
  } as unknown as DeepWriteApi;
  const c = scope.run(() => useShortBookAnalysis({ api: () => api }))!;
  c.setConfiguredModels([model]);
  return {
    c,
    fake,
    abort,
    remove,
    createLibraryEntry,
    dispose() {
      c.dispose();
      scope.stop();
    }
  };
}

function complete(
  c: ReturnType<typeof useShortBookAnalysis>,
  request: ExtrasAgentRunRequest,
  name: string
) {
  c.handleEvent(
    outputEvent(request, {
      kind: "book-analysis-result",
      result: { name, description: "用于提炼写作方法。", content: name }
    })
  );
  c.handleEvent(runEvent("agent.message_completed", request));
}

afterEach(() => {
  vi.useRealTimers();
});

it("removes drafts without deleting saved sources and allows loading them again", async () => {
  const scope = effectScope();
  const sources = [book(0), book(1)];
  const summaries = sources.map(({ text, ...source }) => ({
    ...source,
    characterCount: text.length
  }));
  const remove = vi.fn(async (id: string) => id);
  const load = vi.fn(async () => book(1));
  const api = {
    shortBookAnalysis: {
      sources: {
        delete: remove,
        load,
        list: async () => ({ sources: summaries })
      }
    }
  } as unknown as DeepWriteApi;
  const c = scope.run(() => useShortBookAnalysis({ api: () => api }))!;
  try {
    c.drafts.value = sources;
    c.savedSources.value = summaries;
    c.activeId.value = "book-1";
    c.selectedIds.value = ["book-1"];
    c.removeBook("book-1");
    expect(c.drafts.value.map((source) => source.id)).toEqual(["book-0"]);
    expect(c.activeId.value).toBe("book-0");
    expect(c.selectedIds.value).toEqual([]);
    expect(c.savedSources.value).toEqual(summaries);
    expect(remove).not.toHaveBeenCalled();
    await c.loadSource("book-1");
    expect(load).toHaveBeenCalledWith("book-1");
    expect(c.activeId.value).toBe("book-1");
    expect(c.drafts.value).toHaveLength(2);
    c.removeBook("book-0");
    c.removeBook("book-1");
    expect(c.drafts.value).toEqual([]);
    expect(c.activeId.value).toBe("");
    await c.deleteSource("book-1");
    expect(c.savedSources.value.map((source) => source.id)).toEqual(["book-0"]);
  } finally {
    c.dispose();
    scope.stop();
  }
});

it("clears temporary analysis content while keeping imported stories and model choice", async () => {
  const f = analysisFixture();
  try {
    await f.c.loadPresets();
    f.c.drafts.value = [book(0)];
    f.c.savedSources.value = [{ ...book(0), characterCount: 4 }];
    f.c.selectedIds.value = ["book-0"];
    f.c.activeId.value = "book-0";
    f.c.start();
    expect(() => f.c.resetWorkspace()).toThrow();
    expect(f.c.drafts.value).toHaveLength(1);
    await flush();
    complete(f.c, f.fake.run.mock.calls[0]![0], "临时结果");
    await vi.waitFor(() => expect(f.c.status.value).toBe("completed"));
    f.c.resetWorkspace();
    expect(f.c.drafts.value).toEqual([]);
    expect(f.c.selectedIds.value).toEqual([]);
    expect(f.c.activeId.value).toBe("");
    expect(f.c.batch.results.value).toEqual([]);
    expect(f.c.status.value).toBe("idle");
    expect(f.c.savedSources.value).toHaveLength(1);
    expect(f.c.selectedModelId.value).toBe("model");
    expect(f.c.selectedPresetIds.value).toEqual(["preset"]);
  } finally {
    f.dispose();
  }
});

it("deletes saved sources, repairs selection and active editor, and preserves state on failure", async () => {
  const f = analysisFixture();
  const { c, remove } = f;
  try {
    c.drafts.value = [book(0), book(1), book(2)];
    c.savedSources.value = c.drafts.value.map(({ text, ...source }) => ({
      ...source,
      characterCount: text.length
    }));
    c.selectedIds.value = ["book-0", "book-1"];
    c.activeId.value = "book-1";
    remove.mockRejectedValueOnce(new Error("删除失败"));
    await expect(c.deleteSource("book-1")).rejects.toThrow("删除失败");
    expect(c.drafts.value).toHaveLength(3);
    expect(c.savedSources.value).toHaveLength(3);
    expect(c.selectedIds.value).toEqual(["book-0", "book-1"]);
    expect(c.activeId.value).toBe("book-1");
    expect(c.loading.value).toBe(false);
    await c.deleteSource("book-1");
    expect(remove).toHaveBeenLastCalledWith("book-1");
    expect(c.drafts.value.map((source) => source.id)).toEqual([
      "book-0",
      "book-2"
    ]);
    expect(c.selectedIds.value).toEqual(["book-0"]);
    expect(c.activeId.value).toBe("book-2");
    await c.deleteSource("book-0");
    expect(c.activeId.value).toBe("book-2");
    await c.deleteSource("book-2");
    expect(c.activeId.value).toBe("");
    expect(c.drafts.value).toEqual([]);
    expect(c.savedSources.value).toEqual([]);
    expect(c.selectedIds.value).toEqual([]);
  } finally {
    f.dispose();
  }
});

it("blocks deletion during analysis and while another source operation is pending", async () => {
  const f = analysisFixture();
  const { c, remove } = f;
  let finish!: (id: string) => void;
  remove.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  try {
    await c.loadPresets();
    c.drafts.value = [book(0), book(1)];
    c.selectedIds.value = ["book-0"];
    c.start();
    expect(() => c.removeBook("book-0")).toThrow("正在处理");
    await expect(c.deleteSource("book-0")).rejects.toThrow("正在处理");
    expect(remove).not.toHaveBeenCalled();
    await flush();
    await c.stop();
    await vi.waitFor(() => expect(c.status.value).toBe("stopped"));
    const pending = c.deleteSource("book-0");
    expect(c.loading.value).toBe(true);
    expect(() => c.removeBook("book-1")).toThrow("正在处理");
    await expect(c.deleteSource("book-1")).rejects.toThrow("正在处理");
    expect(() => c.toggleBook("book-1")).toThrow("正在处理");
    finish("book-0");
    await pending;
    expect(c.loading.value).toBe(false);
  } finally {
    f.dispose();
  }
});

it("runs several presets in parallel and saves each result to its own library", async () => {
  const f = analysisFixture([preset, single, skill]);
  const { c, fake, createLibraryEntry } = f;
  try {
    await c.loadPresets();
    expect(c.selectedPresetIds.value).toEqual(["preset"]);
    c.drafts.value = Array.from({ length: 11 }, (_, i) => book(i));
    for (let i = 0; i < 10; i++) c.toggleBook(`book-${i}`);
    expect(c.selectionValid.value).toBe(true);
    expect(() => c.toggleBook("book-10")).toThrow("10");
    expect(c.presetBlock(single)).toBe("single");
    expect(() => c.selectPresets(["preset", "single"])).toThrow("10");
    c.selectPresets(["preset", "skill"]);
    expect(c.selectionLimit.value).toBe(10);
    expect(() =>
      c.selectPresets(["preset", "skill", "a", "b", "c", "d", "e"])
    ).toThrow("6");

    c.start();
    expect(fake.run.mock.calls.map(([request]) => request.task)).toMatchObject([
      { agentId: "short-book-analysis", profileId: "preset" },
      { agentId: "short-book-analysis", profileId: "skill" }
    ]);
    expect(c.batch.counts.value.running).toBe(2);
    expect(() =>
      c.updateBook("book-0", { title: "修改", text: "修改" })
    ).toThrow("正在处理");
    expect(() => c.selectPresets(["preset"])).toThrow("正在处理");
    await flush();
    const [first, second] = fake.run.mock.calls.map(([request]) => request);
    complete(c, second!, "技能结果");
    expect(c.status.value).toBe("running");
    complete(c, first!, "素材结果");
    await vi.waitFor(() => expect(c.status.value).toBe("completed"));
    expect(c.batch.results.value.map((entry) => entry.result.name)).toEqual([
      "素材结果",
      "技能结果"
    ]);
    expect(c.batch.context.value).toContain("测试0");
    expect(createLibraryEntry).not.toHaveBeenCalled();

    c.batch.updateResult("preset", {
      name: "已编辑结果",
      description: "用于提炼写作方法。",
      content: "整理后的综合分析"
    });
    await c.persistResult("preset", {
      libraryId: "library",
      baseProjectRevision: 7
    });
    expect(createLibraryEntry).toHaveBeenCalledWith({
      domain: "material",
      libraryId: "library",
      title: "已编辑结果",
      content:
        '---\nname: "已编辑结果"\ndescription: "用于提炼写作方法。"\n---\n\n整理后的综合分析',
      stageId: "pacing",
      baseProjectRevision: 7
    });
    expect(c.batch.unsavedCount.value).toBe(1);

    c.toggleBook("book-9");
    expect(c.batch.items.value).toEqual([]);
    expect(c.batch.results.value).toHaveLength(2);
    await expect(
      c.persistResults([{ id: "skill", libraryId: "skills" }])
    ).resolves.toEqual({ saved: 1, errors: [] });
    expect(createLibraryEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ domain: "skill", stageId: "outline" })
    );
    expect(c.batch.unsavedCount.value).toBe(0);
  } finally {
    f.dispose();
  }
});

it("waits for a free run slot instead of failing a preset", async () => {
  vi.useFakeTimers();
  const f = analysisFixture([preset, skill]);
  const { c, fake } = f;
  try {
    await c.loadPresets();
    c.drafts.value = [book(0)];
    c.selectedIds.value = ["book-0"];
    c.selectPresets(["preset", "skill"]);
    fake.run.mockRejectedValueOnce({
      code: "agent.extras_capacity_reached",
      message: "更多功能同时运行的分析数量已达到上限"
    });
    c.start();
    await flush();
    await flush();
    expect(c.batch.items.value[0]).toMatchObject({
      state: "queued",
      waiting: true
    });
    expect(c.error.value).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.run).toHaveBeenCalledTimes(3);
    expect(fake.run.mock.calls[2]![0].task).toMatchObject({
      profileId: "preset"
    });
    expect(c.batch.items.value[0]?.state).toBe("running");
  } finally {
    f.dispose();
  }
});

it("saves and resets presets through the unified extras agent profiles", async () => {
  const scope = effectScope();
  const fake = createExtrasAgentsFake({ "short-book-analysis": [preset] });
  const api = {
    extrasAgents: fake.extrasAgents
  } as unknown as DeepWriteApi;
  const c = scope.run(() => useShortBookAnalysis({ api: () => api }))!;
  try {
    await c.loadPresets();
    expect(c.presets.value).toEqual([{ ...preset, builtin: true }]);
    const custom = { ...preset, id: "custom", name: "自定义" };
    await c.savePresets([...c.presets.value, custom]);
    expect(fake.save).toHaveBeenCalledWith({
      agentId: "short-book-analysis",
      baseProfiles: [preset],
      profiles: [preset, custom]
    });
    expect(c.presets.value.map((item) => item.id)).toEqual([
      "preset",
      "custom"
    ]);
    await c.resetPresets();
    expect(c.presets.value.map((item) => item.id)).toEqual(["preset"]);
    expect(c.selectedPresetIds.value).toEqual(["preset"]);
  } finally {
    c.dispose();
    scope.stop();
  }
});

it("selects an imported single book immediately but leaves multiple-book selection explicit", async () => {
  const scope = effectScope();
  const api = {
    shortBookAnalysis: {
      chooseSources: async () => [book(1)],
      sources: {
        list: async () => ({ sources: [] }),
        load: async () => book(2)
      }
    }
  } as unknown as DeepWriteApi;
  const c = scope.run(() => useShortBookAnalysis({ api: () => api }))!;
  try {
    c.presets.value = [single, preset];
    c.selectedPresetIds.value = ["single", "preset"];
    await c.chooseSources();
    expect(c.selectedIds.value).toEqual(["book-1"]);
    expect(c.selectionValid.value).toBe(true);
    await c.loadSource("book-2");
    expect(c.selectedIds.value).toEqual(["book-2"]);
    c.toggleBook("book-1");
    expect(c.selectedIds.value).toEqual(["book-1"]);
    c.selectedPresetIds.value = ["preset"];
    c.selectedIds.value = [];
    await c.chooseSources();
    expect(c.selectedIds.value).toEqual([]);
  } finally {
    c.dispose();
    scope.stop();
  }
});
