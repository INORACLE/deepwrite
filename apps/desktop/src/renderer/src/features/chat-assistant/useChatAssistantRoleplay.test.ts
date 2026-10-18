import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useChatAssistantMode } from "./useChatAssistantMode";
import type { AgentConversationController } from "../../composables/useAgentConversation";
afterEach(() => vi.unstubAllGlobals());
const settle = () => new Promise((resolve) => setTimeout(resolve));
describe("roleplay chat selection", () => {
  it("runs the selected role's profile, isolates controllers and restores the role", async () => {
    const saved = [
      { id: "a", name: "守望者", systemPrompt: "你是守望者。" },
      { id: "b", name: "旅人", systemPrompt: "你是旅人。" }
    ];
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      },
      deepwrite: {
        extrasAgents: {
          profiles: {
            list: vi.fn(async (agentId: string) => ({
              agentId,
              profiles: agentId === "chat-roleplay" ? saved : []
            })),
            save: vi.fn(async (value) => value)
          }
        }
      }
    });
    const busy = ref(false);
    const send = vi.fn(async () => undefined);
    const conversationForKey = vi.fn(
      () =>
        ({
          isBusy: busy,
          sendAssistantMessage: send
        }) as unknown as AgentConversationController
    );
    const options = {
      conversationForKey,
      catalogSnapshot: ref(null),
      longBooks: ref([])
    };
    const mode = useChatAssistantMode(options);
    await settle();
    expect(mode.selectRole("a")).toBe(true);
    expect(conversationForKey).toHaveBeenLastCalledWith(
      "chat-assistant:roleplay:a",
      "assistant-chat:roleplay:a"
    );
    // Roleplay never searches the web, even when the toggle is on.
    await mode.sendAssistantMessage(true);
    expect(send).toHaveBeenLastCalledWith({
      agentId: "chat-roleplay",
      profileId: "a",
      input: {}
    });
    busy.value = true;
    expect(mode.selectRole("b")).toBe(false);
    expect(mode.setMode("normal")).toBe(false);
    busy.value = false;
    mode.selectRole("b");
    expect(conversationForKey).toHaveBeenLastCalledWith(
      "chat-assistant:roleplay:b",
      "assistant-chat:roleplay:b"
    );
    const restored = useChatAssistantMode(options);
    await settle();
    expect(restored.chatTask.value).toEqual({
      agentId: "chat-roleplay",
      profileId: "b",
      input: {}
    });
    restored.setMode("normal");
    expect(conversationForKey).toHaveBeenLastCalledWith(
      "chat-assistant:normal",
      "assistant-chat:normal"
    );
    await restored.sendAssistantMessage(true);
    expect(send).toHaveBeenLastCalledWith({
      agentId: "chat-normal",
      profileId: "default",
      input: { webSearchEnabled: true }
    });
  });
});
