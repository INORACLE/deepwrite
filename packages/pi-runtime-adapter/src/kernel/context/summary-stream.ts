import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  SimpleStreamOptions
} from "@earendil-works/pi-ai";
import type { SummaryModel } from "./summarize";

export const SUMMARY_IDLE_TIMEOUT_MS = 180_000;
export const SUMMARY_TOTAL_TIMEOUT_MS = 600_000;

/** Consume progress as well as the result; an active stream can exceed 2 min. */
export async function streamSummary(
  summary: SummaryModel,
  context: Parameters<StreamFn>[1],
  options: SimpleStreamOptions,
  parentSignal: AbortSignal
): Promise<AssistantMessage> {
  parentSignal.throwIfAborted();
  const timeout = new AbortController();
  const signal = AbortSignal.any([parentSignal, timeout.signal]);
  let idleTimer: ReturnType<typeof setTimeout>;
  const touch = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeout.abort(
        new Error("上下文压缩连续 180 秒没有返回新事件，原上下文已保留。")
      );
    }, SUMMARY_IDLE_TIMEOUT_MS);
  };
  touch();
  const totalTimer = setTimeout(() => {
    timeout.abort(new Error("上下文压缩超过 10 分钟，原上下文已保留。"));
  }, SUMMARY_TOTAL_TIMEOUT_MS);
  let stream: Awaited<ReturnType<StreamFn>> | undefined;
  const result = Promise.resolve().then(async () => {
    signal.throwIfAborted();
    stream = await summary.streamFn(summary.model, context, {
      ...options,
      signal
    });
    // A provider may ignore cancellation while constructing its stream.
    if (signal.aborted) {
      stream.end();
      signal.throwIfAborted();
    }
    for await (const event of stream) {
      signal.throwIfAborted();
      touch();
      if (event.type === "done") return event.message;
      if (event.type === "error") return event.error;
    }
    signal.throwIfAborted();
    return stream.result();
  });
  let abort: () => void = () => {};
  try {
    return await new Promise<AssistantMessage>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      result.then(resolve, reject);
      if (signal.aborted) abort();
    });
  } finally {
    clearTimeout(idleTimer!);
    clearTimeout(totalTimer);
    signal.removeEventListener("abort", abort);
    // Release the iterator even when the provider ignores the abort signal.
    stream?.end();
  }
}
