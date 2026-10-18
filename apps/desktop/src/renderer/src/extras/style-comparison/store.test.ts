import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createExtrasAgentsFake } from "../agent-runtime/extrasAgent.test-support";
import { useStyleComparisonStore } from "./store";
import {
  DEFAULT_STYLE_COMPARISON_METHOD,
  PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD
} from "./method";

const LEGACY_METHOD_KEY = "deepwrite.style-comparison.method.v1";
const defaultProfile = {
  id: "default",
  name: "文风比对",
  description: "测试方法",
  systemPrompt: DEFAULT_STYLE_COMPARISON_METHOD
};
let storage: Map<string, string>;
let fake: ReturnType<typeof createExtrasAgentsFake>;
let store: ReturnType<typeof useStyleComparisonStore> | undefined;

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

beforeEach(() => {
  setActivePinia(createPinia());
  storage = new Map();
  fake = createExtrasAgentsFake({ "style-comparison": [defaultProfile] });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  vi.stubGlobal("window", { deepwrite: { extrasAgents: fake.extrasAgents } });
});

afterEach(() => {
  store?.$dispose();
  store = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("文风比对方法保存", () => {
  it("imports a customized legacy method once, including an intentional empty value", async () => {
    for (const method of ["重点比较对白节奏，保留我的权重。", ""]) {
      fake = createExtrasAgentsFake({ "style-comparison": [defaultProfile] });
      vi.stubGlobal("window", {
        deepwrite: { extrasAgents: fake.extrasAgents }
      });
      storage.set(LEGACY_METHOD_KEY, method);
      setActivePinia(createPinia());
      store = useStyleComparisonStore();
      await flush();
      expect(store.method).toBe(method);
      expect(fake.save).toHaveBeenCalledWith({
        agentId: "style-comparison",
        baseProfiles: [defaultProfile],
        profiles: [{ ...defaultProfile, systemPrompt: method }]
      });
      expect(storage.has(LEGACY_METHOD_KEY)).toBe(false);
      store.$dispose();
    }
  });

  it("drops the previous or current default without saving it", async () => {
    for (const method of [
      PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD,
      DEFAULT_STYLE_COMPARISON_METHOD
    ]) {
      storage.set(LEGACY_METHOD_KEY, method);
      setActivePinia(createPinia());
      store = useStyleComparisonStore();
      await flush();
      expect(store.method).toBe(DEFAULT_STYLE_COMPARISON_METHOD);
      expect(storage.has(LEGACY_METHOD_KEY)).toBe(false);
      store.$dispose();
    }
    expect(fake.save).not.toHaveBeenCalled();
  });

  it("keeps an already customized profile over a leftover legacy method", async () => {
    fake = createExtrasAgentsFake({ "style-comparison": [defaultProfile] });
    await fake.extrasAgents.profiles.save({
      agentId: "style-comparison",
      profiles: [{ ...defaultProfile, systemPrompt: "统一配置里的方法" }]
    });
    fake.save.mockClear();
    vi.stubGlobal("window", { deepwrite: { extrasAgents: fake.extrasAgents } });
    storage.set(LEGACY_METHOD_KEY, "旧浏览器存储里的方法");
    store = useStyleComparisonStore();
    await flush();
    expect(store.method).toBe("统一配置里的方法");
    expect(fake.save).not.toHaveBeenCalled();
    expect(storage.has(LEGACY_METHOD_KEY)).toBe(false);
  });

  it("auto-saves edits to the profile after typing pauses", async () => {
    vi.useFakeTimers();
    store = useStyleComparisonStore();
    await flush();
    store.method = "只比较句式";
    await flush();
    expect(fake.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.save).toHaveBeenCalledWith({
      agentId: "style-comparison",
      baseProfiles: [defaultProfile],
      profiles: [{ ...defaultProfile, systemPrompt: "只比较句式" }]
    });
    store.method = "再比较对白";
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.save).toHaveBeenLastCalledWith({
      agentId: "style-comparison",
      baseProfiles: [{ ...defaultProfile, systemPrompt: "只比较句式" }],
      profiles: [{ ...defaultProfile, systemPrompt: "再比较对白" }]
    });
  });
});
