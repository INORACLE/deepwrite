import { randomUUID } from "node:crypto";
import type {
  AgentMessage,
  StreamFn,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  isRetryableAssistantError,
  type Api,
  type AssistantMessage,
  type Model,
  type Usage
} from "@earendil-works/pi-ai";
import { estimateTextTokens, type AgentRuntimeRef } from "@deepwrite/contracts";

import { serializeForSummary } from "./serialize";
import type { ConversationContextState } from "./state";
import {
  SUMMARY_SYSTEM_PROMPT,
  initialSummaryPrompt,
  updateSummaryPrompt
} from "./summary-prompts";
import type { ContextTaskKind } from "./types";

const SUMMARY_RETRY_DELAYS_MS = [1_000, 3_000] as const;

/** The model that writes summaries; `local` is the offline faux runtime. */
export interface SummaryModel {
  model: Model<Api>;
  streamFn: StreamFn;
  thinkingLevel: PiThinkingLevel;
  runtime: AgentRuntimeRef;
  local: boolean;
}

export interface SummaryUsage {
  usage: Usage;
  status: "completed" | "error" | "aborted";
  runtime: AgentRuntimeRef;
}

export interface SummaryRequest {
  task: ContextTaskKind;
  instructions?: string;
  maxTokens: number;
  signal: AbortSignal;
  state: ConversationContextState;
  onUsage(usage: SummaryUsage): void;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

/** Offline stand-in used by the faux runtime and tests. */
function localSummary(prompt: string): string {
  const users = [...prompt.matchAll(/^\[用户\][^:]*: (.+)$/gm)]
    .map((match) => match[1]!.trim().slice(0, 120))
    .slice(-8);
  const previous = /<previous-summary>\n([\s\S]*?)\n<\/previous-summary>/.exec(
    prompt
  )?.[1];
  return [
    "## 本会话创作目标",
    ...(users.length ? users.map((line) => `- ${line}`) : ["- 无"]),
    "",
    "## 进度",
    "- 已整理较早对话（本地模拟摘要）",
    ...(previous ? ["", "## 之前的检查点", previous.trim()] : [])
  ].join("\n");
}

async function complete(
  summaryModel: SummaryModel,
  prompt: string,
  request: SummaryRequest
): Promise<string> {
  request.signal.throwIfAborted();
  if (summaryModel.local) return localSummary(prompt);
  const { model, streamFn, thinkingLevel } = summaryModel;
  for (let attempt = 0; ; attempt += 1) {
    request.signal.throwIfAborted();
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(120_000)
    ]);
    const stream = streamFn(
      model,
      normalizeContext({
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
            timestamp: Date.now()
          }
        ]
      }),
      {
        maxTokens: Math.min(
          request.maxTokens,
          model.maxTokens || request.maxTokens
        ),
        signal,
        maxRetries: 0,
        // One-off requests: isolate routing and skip unreusable cache writes.
        cacheRetention: "none",
        sessionId: randomUUID(),
        ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel })
      }
    );
    const result = await abortable(
      Promise.resolve(stream).then((value) => value.result()),
      signal
    );
    request.onUsage({
      usage: result.usage,
      runtime: summaryModel.runtime,
      status:
        result.stopReason === "aborted"
          ? "aborted"
          : result.stopReason === "error"
            ? "error"
            : "completed"
    });
    if (result.stopReason === "aborted") {
      throw request.signal.reason ?? new Error("上下文压缩已中止。");
    }
    const delay = SUMMARY_RETRY_DELAYS_MS[attempt];
    if (result.stopReason === "error") {
      if (delay !== undefined && isRetryableAssistantError(result)) {
        await wait(delay, request.signal);
        continue;
      }
      throw new Error(result.errorMessage || "摘要模型请求失败。");
    }
    request.signal.throwIfAborted();
    if (result.stopReason !== "stop")
      throw new Error("摘要输出不完整，保留原上下文。请提高摘要模型输出上限。");
    const text = assistantText(result);
    if (text.length > 32_000)
      throw new Error("摘要超过保存上限，保留原上下文。");
    if (!text) throw new Error("摘要模型没有返回内容。");
    return text;
  }
}

/** Even a provider that never finishes its stream must release the run. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Fold every character, including the middle of long user messages, into
 * bounded requests. The previous summary and instructions count each time. */
export async function summarizeMessages(
  summaryModel: SummaryModel,
  messages: readonly AgentMessage[],
  previousSummary: string | undefined,
  request: SummaryRequest
): Promise<string> {
  const window = summaryModel.model.contextWindow || 128_000;
  const output = Math.min(
    request.maxTokens,
    summaryModel.model.maxTokens || request.maxTokens
  );
  let remaining = serializeForSummary(messages, request.state);
  let summary = previousSummary;
  while (remaining.length) {
    const instructions = summary
      ? updateSummaryPrompt(request.task, request.instructions)
      : initialSummaryPrompt(request.task, request.instructions);
    const previous = summary
      ? `<previous-summary>\n${summary}\n</previous-summary>`
      : "";
    const overhead =
      estimateTextTokens(SUMMARY_SYSTEM_PROMPT + instructions + previous) *
        1.5 +
      512;
    const available = Math.floor((window - output - overhead) * 0.7);
    if (available < 256)
      throw new Error(
        "摘要模型上下文不足以容纳已有摘要，请选择更大窗口的摘要模型。"
      );
    let end = 0;
    let tokens = 0;
    for (const char of remaining) {
      const size = char.codePointAt(0)! > 127 ? 1.5 : 0.25;
      if (tokens + size > available) break;
      tokens += size;
      end += char.length;
    }
    const conversation = remaining.slice(0, end);
    remaining = remaining.slice(end);
    const prompt = [
      `<conversation>\n${conversation}\n</conversation>`,
      previous,
      instructions
    ]
      .filter(Boolean)
      .join("\n\n");
    summary = await complete(summaryModel, prompt, request);
  }
  if (!summary) throw new Error("没有可以压缩的对话内容。");
  return summary;
}

export async function summarizeTurnPrefix(
  model: SummaryModel,
  messages: readonly AgentMessage[],
  request: SummaryRequest
): Promise<string> {
  return summarizeMessages(model, messages, undefined, {
    ...request,
    instructions: [
      request.instructions,
      "这是尚未结束的一轮工作的前半段；保留原始目标、已完成操作、未执行操作和后续衔接依据。"
    ]
      .filter(Boolean)
      .join("\n")
  });
}
