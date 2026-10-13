import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { createConversationSyncLease } from "./useConversationSyncLease";

function controller(options: { busy?: boolean; draft?: string } = {}) {
  return {
    isBusy: ref(options.busy ?? false),
    hasPendingEditReview: ref(false),
    sessionId: ref("s1"),
    draft: ref(options.draft ?? ""),
    holdPersistenceEmits: vi.fn(),
    releasePersistenceEmits: vi.fn()
  } as unknown as AgentConversationController & {
    holdPersistenceEmits: ReturnType<typeof vi.fn>;
    releasePersistenceEmits: ReturnType<typeof vi.fn>;
  };
}

function setup(controllers: Record<string, AgentConversationController>) {
  const live = new Map(Object.entries(controllers));
  const rebuilt = controller();
  const store = {
    controllerForKey: (key: string) => live.get(key),
    scopeForKey: () => "book:book-1",
    removeController: vi.fn((key: string) => live.delete(key)),
    scheduleControllerPersistence: vi.fn(),
    flushPersistence: vi.fn(async () => {}),
    invalidatePersistenceCache: vi.fn()
  };
  const registry = {
    conversationForKey: vi.fn((key: string) => {
      live.set(key, rebuilt);
      return rebuilt;
    }),
    drain: vi.fn(async () => {})
  };
  return {
    store,
    registry,
    rebuilt,
    lease: createConversationSyncLease({ store, registry })
  };
}

describe("conversation sync lease", () => {
  it("saves and holds idle conversations and leaves running ones alone", async () => {
    const idle = controller();
    const running = controller({ busy: true });
    const { lease, store } = setup({ "a:chat": idle, "b:chat": running });
    const released = await lease.lease({
      requestId: "r1",
      keys: ["a:chat", "b:chat", "c:chat"]
    });
    expect(released).toEqual(["a:chat", "c:chat"]);
    expect(idle.holdPersistenceEmits).toHaveBeenCalled();
    expect(running.holdPersistenceEmits).not.toHaveBeenCalled();
    expect(store.flushPersistence).toHaveBeenCalledTimes(2);
  });

  it("rebuilds changed conversations from storage and keeps text typed meanwhile", async () => {
    const changed = controller({ draft: "还没发送的话" });
    const unchanged = controller();
    const { lease, store, registry, rebuilt } = setup({
      "a:chat": changed,
      "b:chat": unchanged
    });
    await lease.lease({ requestId: "r1", keys: ["a:chat", "b:chat"] });
    await lease.changed({ requestId: "r1", changed: ["a:chat"] });
    expect(store.removeController).toHaveBeenCalledWith("a:chat");
    expect(store.invalidatePersistenceCache).toHaveBeenCalled();
    expect(registry.conversationForKey).toHaveBeenCalledWith(
      "a:chat",
      "book:book-1"
    );
    expect(rebuilt.draft.value).toBe("还没发送的话");
    expect(unchanged.releasePersistenceEmits).toHaveBeenCalled();
    expect(store.removeController).not.toHaveBeenCalledWith("b:chat");
  });
});
