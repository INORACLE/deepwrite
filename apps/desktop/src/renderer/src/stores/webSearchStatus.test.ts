import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { WebSearchSettings } from "@deepwrite/contracts/renderer";
import { useWebSearchStatusStore } from "./webSearchStatus";

function settings(overrides: Partial<WebSearchSettings> = {}) {
  return {
    enabled: true,
    activeProviderId: "deepseek",
    perRunCallLimit: 20,
    profiles: [{ providerId: "deepseek", maxResults: 8, hasApiKey: true }],
    ...overrides
  } as WebSearchSettings;
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.unstubAllGlobals());

describe("web search status store", () => {
  it("is unusable until settings are known", () => {
    expect(useWebSearchStatusStore().usable).toBe(false);
  });

  it("needs search on and a key for the active provider", () => {
    const store = useWebSearchStatusStore();
    store.apply(settings());
    expect(store.usable).toBe(true);
    store.apply(settings({ enabled: false }));
    expect(store.usable).toBe(false);
    store.apply(
      settings({
        profiles: [{ providerId: "deepseek", maxResults: 8, hasApiKey: false }]
      })
    );
    expect(store.usable).toBe(false);
  });

  it("reads the settings once however many switches ask", async () => {
    const getSettings = vi.fn(async () => settings());
    vi.stubGlobal("window", { deepwrite: { webSearch: { getSettings } } });
    const store = useWebSearchStatusStore();
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);
    await store.ensureLoaded();
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(store.usable).toBe(true);
  });

  it("stays unavailable and can retry after a failed read", async () => {
    const getSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValue(settings());
    vi.stubGlobal("window", { deepwrite: { webSearch: { getSettings } } });
    const store = useWebSearchStatusStore();
    await store.ensureLoaded();
    expect(store.usable).toBe(false);
    await store.ensureLoaded();
    expect(store.usable).toBe(true);
  });

  it("stays unavailable without the desktop bridge", async () => {
    vi.stubGlobal("window", {});
    const store = useWebSearchStatusStore();
    await store.ensureLoaded();
    expect(store.usable).toBe(false);
  });
});
