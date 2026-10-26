import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistant, model, runtime, user } from "./context.test-support";
import { ConversationContextState } from "./state";
import { summarizeMessages } from "./summarize";
import { summarizeInPlace } from "./summarize-in-place";
import {
  SUMMARY_IDLE_TIMEOUT_MS,
  SUMMARY_TOTAL_TIMEOUT_MS
} from "./summary-stream";

function run(kind: "serialized" | "in-place", streamFn: StreamFn) {
  const controller = new AbortController();
  const summary = {
    model,
    streamFn,
    runtime,
    local: false,
    thinkingLevel: "off" as const
  };
  const request = {
    task: "general" as const,
    targetTokens: 500,
    signal: controller.signal,
    state: new ConversationContextState(),
    onUsage: vi.fn()
  };
  const messages = [user("保留人物约束与未完成事项")];
  const result =
    kind === "serialized"
      ? summarizeMessages(summary, messages, undefined, request)
      : summarizeInPlace(
          summary,
          { systemPrompt: "写作", tools: [], sessionId: "test-session" },
          messages,
          request
        );
  return { controller, result, request };
}

afterEach(() => vi.useRealTimers());

describe.each(["serialized", "in-place"] as const)(
  "%s summary stream",
  (kind) => {
    it("keeps a progressing thinking stream alive past the former 120s deadline", async () => {
      vi.useFakeTimers();
      const stream = createAssistantMessageEventStream();
      let signal: AbortSignal | undefined;
      const { result } = run(kind, (_model, _context, options) => {
        signal = options?.signal;
        return stream;
      });
      await vi.advanceTimersByTimeAsync(110_000);
      stream.push({
        type: "thinking_delta",
        contentIndex: 0,
        delta: "整理约束",
        partial: assistant()
      });
      await vi.advanceTimersByTimeAsync(110_000);
      expect(signal?.aborted).toBe(false);
      const message = assistant("已保留的完整检查点");
      stream.push({ type: "done", reason: "stop", message });
      await expect(result).resolves.toBe("已保留的完整检查点");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("releases a stalled provider even if it ignores the abort signal", async () => {
      vi.useFakeTimers();
      const stream = createAssistantMessageEventStream();
      let signal: AbortSignal | undefined;
      const { result } = run(kind, (_model, _context, options) => {
        signal = options?.signal;
        return stream;
      });
      const rejected = expect(result).rejects.toThrow("连续 180 秒");
      await vi.advanceTimersByTimeAsync(SUMMARY_IDLE_TIMEOUT_MS);
      await rejected;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("honors user cancellation while a provider is still opening the stream", async () => {
      vi.useFakeTimers();
      const { controller, result } = run(kind, () => new Promise(() => {}));
      const rejected = expect(result).rejects.toThrow("user canceled");
      await vi.advanceTimersByTimeAsync(1);
      controller.abort(new Error("user canceled"));
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    });

    it("bounds an endless stream even when it continues emitting events", async () => {
      vi.useFakeTimers();
      const stream = createAssistantMessageEventStream();
      const { result } = run(kind, () => stream);
      const rejected = expect(result).rejects.toThrow("超过 10 分钟");
      for (
        let elapsed = 60_000;
        elapsed < SUMMARY_TOTAL_TIMEOUT_MS;
        elapsed += 60_000
      ) {
        await vi.advanceTimersByTimeAsync(60_000);
        stream.push({
          type: "thinking_delta",
          contentIndex: 0,
          delta: "继续整理",
          partial: assistant()
        });
      }
      await vi.advanceTimersByTimeAsync(60_000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    });

    it("records a truncated checkpoint as an error and refuses to use it", async () => {
      const { result, request } = run(kind, () => {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "done",
          reason: "length",
          message: assistant("不完整", "length")
        });
        return stream;
      });
      await expect(result).rejects.toThrow();
      expect(request.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({ status: "error" })
      );
    });

    it("keeps a complete checkpoint that exceeds the prompt's soft length target", async () => {
      const text = "需要完整保留的用户约束。".repeat(100);
      const { result } = run(kind, () => {
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message: assistant(text) });
        return stream;
      });
      await expect(result).resolves.toBe(text);
    });
  }
);
