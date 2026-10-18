import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../preload/invoke", () => ({
  invokeCommand: invoke,
  browserId: () => "web_search_command_test"
}));
import { webSearch } from "../../preload/web-search-api";

const settings = {
  enabled: true,
  activeProviderId: "deepseek",
  perRunCallLimit: 20,
  profiles: [{ providerId: "deepseek", maxResults: 8, hasApiKey: true }]
};

describe("web search preload validation", () => {
  beforeEach(() => invoke.mockReset());

  it("rejects secret-bearing settings responses", async () => {
    invoke.mockResolvedValue({
      ...settings,
      profiles: [{ ...settings.profiles[0], apiKey: "invalid-placeholder" }]
    });
    await expect(webSearch.getSettings()).rejects.toThrow();
  });

  it("sends validated settings and returns only public fields", async () => {
    invoke.mockResolvedValue(settings);
    const saved = await webSearch.saveSettings({
      enabled: true,
      activeProviderId: "deepseek",
      perRunCallLimit: 20,
      profiles: [
        { providerId: "deepseek", maxResults: 8, apiKey: "invalid-test-key" }
      ]
    });
    expect(invoke.mock.calls[0]![0]).toMatchObject({
      type: "webSearch.saveSettings"
    });
    expect(saved.profiles[0]).not.toHaveProperty("apiKey");
  });

  it("rejects invalid requests before IPC", async () => {
    await expect(
      webSearch.saveSettings({
        enabled: true,
        activeProviderId: "deepseek",
        perRunCallLimit: 500,
        profiles: []
      })
    ).rejects.toThrow();
    await expect(
      webSearch.test({ providerId: "deepseek", query: " " })
    ).rejects.toThrow();
    await expect(
      webSearch.importKey({
        providerId: "unknown",
        sourceModelId: "m"
      } as never)
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("validates each reply shape", async () => {
    invoke.mockResolvedValue({
      resultCount: 1,
      elapsedMs: 5,
      samples: [{ title: "结果", url: "javascript:alert(1)" }]
    });
    await expect(webSearch.test({ providerId: "deepseek" })).rejects.toThrow();

    invoke.mockResolvedValue({
      hasCurrentKey: false,
      candidates: [
        {
          sourceModelId: "m_chat",
          keyHint: "…a1b2",
          models: [{ id: "m_chat", label: "模型" }],
          matchesCurrentKey: false,
          apiKey: "invalid-placeholder"
        }
      ]
    });
    await expect(
      webSearch.listKeyImportCandidates({ providerId: "deepseek" })
    ).rejects.toThrow();

    invoke.mockResolvedValue(settings);
    await webSearch.setEnabled({ enabled: false });
    await webSearch.importKey({ providerId: "deepseek", sourceModelId: "m" });
    // The first two replies were rejected only after their commands went out.
    expect(
      invoke.mock.calls.slice(-2).map(([command]) => command.type)
    ).toEqual(["webSearch.setEnabled", "webSearch.importKey"]);
  });
});
