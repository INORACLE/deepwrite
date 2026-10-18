import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import {
  createDeferredApi,
  document,
  runtime
} from "./useAgentConversation.test-support";
import { useAgentConversation } from "./useAgentConversation";

describe("agent conversation prompt length", () => {
  it.each(["skill", "material", "creation", "chat"] as const)(
    "retains an over-budget %s draft and sends the same text after the configured budget increases",
    async (domain) => {
      const deferred = createDeferredApi();
      const flushPersistence = vi.fn(async () => undefined);
      const budgetTokens = ref(64_000);
      const controller = useAgentConversation({
        api: () => deferred.api,
        flushPersistence,
        contextCompactionBudgetTokens: () => budgetTokens.value
      });
      const activeDocument = {
        ...document,
        domain: domain === "chat" ? ("creation" as const) : domain
      };
      const send = () =>
        domain === "chat"
          ? controller.sendAssistantMessage({
              agentId: "chat-normal",
              profileId: "default",
              input: {}
            })
          : controller.sendMessage(activeDocument);
      const message = "字".repeat(57_601);
      const draft = `  ${message}\n`;
      try {
        controller.draft.value = draft;
        await send();
        expect(deferred.promptCount()).toBe(0);
        expect(flushPersistence).not.toHaveBeenCalled();
        expect(controller.draft.value).toBe(draft);
        expect(controller.messages.value).toEqual([]);
        expect(controller.isBusy.value).toBe(false);
        expect(controller.conversationError.value).toBe(
          "消息和附件约 57,601 token，超过当前可用的 57,600 token。已按压缩上下文上限 64,000 token 预留 10% 余量，请缩短内容或调整设置。"
        );

        budgetTokens.value = 128_000;
        const sending = send();
        await Promise.resolve();
        expect(flushPersistence).toHaveBeenCalledOnce();
        expect(deferred.promptCount()).toBe(1);
        expect(
          domain === "chat"
            ? deferred.chatRuns[0]?.conversation?.message
            : deferred.prompts[0]?.message
        ).toBe(message);
        expect(controller.conversationError.value).toBeNull();
        deferred.resolveAccepted(0, {
          sessionId: controller.sessionId.value,
          runId: "run-prompt-boundary",
          acceptedAt: "2026-10-16T00:00:00.000Z",
          runtime
        });
        await sending;
        expect(controller.draft.value).toBe("");
        expect(controller.messages.value[0]?.content).toBe(message);
      } finally {
        controller.dispose();
      }
    }
  );
});
