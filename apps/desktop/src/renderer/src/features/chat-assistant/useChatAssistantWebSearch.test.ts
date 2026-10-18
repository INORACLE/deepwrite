import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import {
  CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY,
  useChatAssistantWebSearch
} from "./useChatAssistantWebSearch";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY, initial);
  }
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    value: () => values.get(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY)
  };
}

describe("chat assistant web search preference", () => {
  it("restores an enabled preference while the settings allow search", () => {
    const feature = useChatAssistantWebSearch({
      available: ref(true),
      storage: storage("true")
    });

    expect(feature.available.value).toBe(true);
    expect(feature.enabled.value).toBe(true);
  });

  it("shows the switch off while the settings do not allow search, and remembers the choice", async () => {
    const available = ref(true);
    const persisted = storage("true");
    const feature = useChatAssistantWebSearch({
      available,
      storage: persisted
    });

    available.value = false;
    expect(feature.enabled.value).toBe(false);
    expect(persisted.value()).toBe("true");

    available.value = true;
    expect(feature.enabled.value).toBe(true);
  });

  it("does not turn on while search is unavailable", () => {
    const persisted = storage();
    const feature = useChatAssistantWebSearch({
      available: ref(false),
      storage: persisted
    });

    expect(feature.setEnabled(true)).toBe(false);
    expect(feature.enabled.value).toBe(false);
    expect(persisted.setItem).not.toHaveBeenCalled();
  });

  it("turns off and persists even while search is unavailable", () => {
    const available = ref(true);
    const persisted = storage("true");
    const feature = useChatAssistantWebSearch({
      available,
      storage: persisted
    });

    available.value = false;
    expect(feature.setEnabled(false)).toBe(true);
    expect(persisted.value()).toBe("false");
    available.value = true;
    expect(feature.enabled.value).toBe(false);
  });

  it("keeps working in memory when storage is missing or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    const feature = useChatAssistantWebSearch({
      available: ref(true),
      storage: throwing
    });
    expect(feature.enabled.value).toBe(false);
    expect(feature.setEnabled(true)).toBe(true);
    expect(feature.enabled.value).toBe(true);
    const bare = useChatAssistantWebSearch({
      available: ref(true),
      storage: null
    });
    expect(bare.setEnabled(true)).toBe(true);
    expect(bare.enabled.value).toBe(true);
  });
});
