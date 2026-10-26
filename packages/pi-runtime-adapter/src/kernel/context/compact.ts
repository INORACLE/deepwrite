import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import type {
  AgentContextCompactionReason,
  ConversationCheckpoint
} from "@deepwrite/contracts";
import type { ContextBudget } from "./budget";
import { findCutPoint } from "./cut-point";
import {
  summarizeInPlace,
  type InPlaceSummaryTarget
} from "./summarize-in-place";
import { pruneMessages, toolCallsById } from "./prune";
import type { ConversationContextState } from "./state";
import {
  summarizeMessages,
  summarizeTurnPrefix,
  type SummaryModel,
  type SummaryUsage
} from "./summarize";
import { estimateMessagesTokens } from "./token-count";
import type {
  ContextCompactionOutcome,
  ContextPolicy,
  ContextRefs
} from "./types";

const REFS_PER_KIND_IN_SUMMARY = 40;
const REF_LABELS: Record<keyof ContextRefs, string> = {
  read: "已完整读取",
  proposed: "已提交修改",
  skills: "已加载技能",
  materials: "已查阅素材"
};

export const CHECKPOINT_PREFIX =
  "【较早对话的压缩检查点】\n以下是本会话较早轮次的结构化摘要，由系统生成。作品正文、设定与结构以作品当前内容为准；压缩前读取过的正文已不在上下文中，修改已有内容前请重新读取。\n\n<summary>\n";
export const CHECKPOINT_SUFFIX = "\n</summary>";

export interface CompactionRequest {
  messages: readonly AgentMessage[];
  state: ConversationContextState;
  policy: ContextPolicy;
  budget: ContextBudget;
  reason: AgentContextCompactionReason;
  /** Messages from here on are never pruned. */
  protectFrom: number;
  /** Tokens of the request before compaction (usage-anchored when possible). */
  tokensBefore: number;
  /** System prompt and tool schemas, which compaction cannot shrink. */
  fixedTokens: number;
  /** Summarize even below the thresholds (manual and overflow). */
  force: boolean;
  allowSplitTurn: boolean;
  summaryModel: SummaryModel;
  /** Present when the policy summarizes a split turn in place. */
  inPlace?: InPlaceSummaryTarget;
  signal: AbortSignal;
  /** Called once, right before the first summary request. */
  onSummaryStart(): void;
  onUsage(usage: SummaryUsage): void;
}

export interface CompactionResult {
  messages: AgentMessage[];
  outcome: ContextCompactionOutcome;
}

/** Records business references from tool calls before their output shrinks. */
export function collectRefs(
  messages: readonly AgentMessage[],
  end: number,
  state: ConversationContextState,
  policy: ContextPolicy
): void {
  const results = new Map<
    string,
    Extract<AgentMessage, { role: "toolResult" }>
  >();
  for (const message of messages.slice(0, end)) {
    if (message.role === "toolResult") results.set(message.toolCallId, message);
  }
  for (const [id, call] of toolCallsById(messages.slice(0, end))) {
    const result = results.get(id);
    if (!result || result.isError) continue;
    const refs = policy.toolCompactors[call.name]?.refs?.(call, result);
    if (refs) state.addRefs(refs);
  }
}

function refsBlock(refs: ContextRefs): string {
  const lines = (Object.keys(REF_LABELS) as Array<keyof ContextRefs>).flatMap(
    (kind) => {
      const values = refs[kind].slice(-REFS_PER_KIND_IN_SUMMARY);
      return values.length ? [`${REF_LABELS[kind]}：${values.join("、")}`] : [];
    }
  );
  return lines.length
    ? `\n\n<系统追踪的引用>\n${lines.join("\n")}\n</系统追踪的引用>`
    : "";
}

/** Strips a previous refs block so iterative updates do not nest them. */
function withoutRefsBlock(summary: string): string {
  return summary.replace(
    /\n*<系统追踪的引用>[\s\S]*?<\/系统追踪的引用>\s*$/,
    ""
  );
}

export function checkpointMessage(
  checkpoint: ConversationCheckpoint,
  rehydration: string | undefined,
  timestamp: number
): UserMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `${CHECKPOINT_PREFIX}${checkpoint.summary}${CHECKPOINT_SUFFIX}${checkpoint.refs ? refsBlock(checkpoint.refs) : ""}`
      },
      ...(rehydration
        ? [
            {
              type: "text" as const,
              text: `【压缩后恢复的参考内容（系统从技能库与作品中重新读取，不是对话记录）】\n${rehydration}`
            }
          ]
        : [])
    ],
    timestamp
  };
}

function runIdFrom(
  messages: readonly AgentMessage[],
  index: number,
  state: ConversationContextState
): string | undefined {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const runId = state.runStarts.get(messages[cursor]!);
    if (runId !== undefined) return runId;
  }
  return undefined;
}

/**
 * Two-level compaction. Stale tool output and snapshots are pruned first; if
 * the context is still over its threshold (or the caller forces it), older
 * turns are folded into the conversation checkpoint and source content the
 * policy names is re-attached after it.
 */
export async function compactMessages(
  request: CompactionRequest
): Promise<CompactionResult | undefined> {
  const { state, policy, budget, reason, messages } = request;
  collectRefs(messages, request.protectFrom, state, policy);
  const pruned = pruneMessages(
    messages,
    request.protectFrom,
    policy.toolCompactors,
    state
  );
  if (pruned.snapshotStubbed) state.markFixedContextStale();
  const saved =
    estimateMessagesTokens(messages) - estimateMessagesTokens(pruned.messages);
  const afterPrune = Math.max(0, request.tokensBefore - saved);
  const limit =
    reason === "threshold" || reason === "idle"
      ? budget.summarizeAt
      : budget.working;
  const pruneOutcome: CompactionResult | undefined = pruned.changed
    ? {
        messages: pruned.messages,
        outcome: {
          reason,
          level: "prune",
          tokensBefore: request.tokensBefore,
          tokensAfter: afterPrune
        }
      }
    : undefined;
  if (!request.force && afterPrune <= limit) return pruneOutcome;

  const summaryIndex = state.summaryMessage
    ? pruned.messages.indexOf(state.summaryMessage)
    : -1;
  const start = summaryIndex + 1;
  const cut = findCutPoint(
    pruned.messages,
    start,
    Math.min(
      budget.keepRecentTokens,
      Math.floor(estimateMessagesTokens(pruned.messages) * 0.5)
    ),
    (message) => state.isRunStart(message),
    request.allowSplitTurn
  );
  if (!cut) return pruneOutcome;

  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptIndex;
  collectRefs(pruned.messages, cut.firstKeptIndex, state, policy);
  const summaryRequest = {
    task: policy.task,
    ...(policy.manual?.instructions
      ? { instructions: policy.manual.instructions }
      : {}),
    targetTokens: budget.summaryTargetTokens,
    signal: request.signal,
    state,
    onUsage: request.onUsage
  };
  const previous = state.checkpoint
    ? withoutRefsBlock(state.checkpoint.summary)
    : undefined;
  // Summary sees original messages; L1 stubs must not erase decisions before
  // the summary has had a chance to preserve them.
  const history = messages.slice(start, historyEnd);
  request.onSummaryStart();
  let summary = history.length
    ? await summarizeMessages(
        request.summaryModel,
        history,
        previous,
        summaryRequest
      )
    : (previous ?? "");
  const kept: AgentMessage[] = [];
  if (cut.isSplitTurn) {
    const runStart = messages[cut.turnStartIndex]!;
    const prefix = messages.slice(cut.turnStartIndex + 1, cut.firstKeptIndex);
    // Without earlier history the turn so far is exactly what the run sent,
    // so an in-place summary can reuse the provider's cached prefix.
    const inPlace =
      request.inPlace && !history.length
        ? await summarizeInPlace(
            request.summaryModel,
            request.inPlace,
            messages.slice(0, cut.firstKeptIndex),
            summaryRequest
          ).catch((error: unknown) => {
            if (request.signal.aborted) throw error;
            return undefined;
          })
        : undefined;
    const prefixSummary =
      inPlace ??
      (await summarizeTurnPrefix(
        request.summaryModel,
        [runStart, ...prefix],
        summaryRequest
      ));
    summary = `${summary || "（此前没有更早的对话。）"}\n\n---\n\n**当前这一轮的前半段：**\n\n${prefixSummary}`;
    kept.push(runStart);
  }
  kept.push(...pruned.messages.slice(cut.firstKeptIndex));

  // A text-only summarizer cannot replace visual evidence. Preserve the
  // original image-bearing requests even when surrounding text is summarized.
  let restoreStart = historyEnd;
  for (let index = historyEnd - 1; index >= start; index -= 1) {
    const original = messages[index]!;
    if (
      original.role === "user" &&
      Array.isArray(original.content) &&
      original.content.some((block) => block.type === "image")
    ) {
      kept.unshift(pruned.messages[index]!);
      restoreStart = Math.min(restoreStart, index);
    }
  }

  if (summary.length > 38_000) throw new Error("摘要过长，保留原上下文。");
  const checkpoint: ConversationCheckpoint = {
    summary: summary.trim(),
    ...(() => {
      const runId = runIdFrom(pruned.messages, restoreStart, state);
      return runId ? { firstKeptRunId: runId } : {};
    })(),
    firstKeptCreatedAt: new Date(
      messages[restoreStart]!.timestamp
    ).toISOString(),
    tokensBefore: request.tokensBefore,
    createdAt: new Date().toISOString(),
    refs: structuredClone(state.refs)
  };
  const rehydration = await policy.rehydrate?.(
    state.refs,
    budget.rehydrateTokens
  );
  const message = checkpointMessage(checkpoint, rehydration, Date.now());
  state.checkpoint = checkpoint;
  state.summaryMessage = message;
  state.pruned.add(message);
  state.markFixedContextStale();
  const next = [message, ...kept];
  return {
    messages: next,
    outcome: {
      reason,
      level: "summary",
      tokensBefore: request.tokensBefore,
      tokensAfter: request.fixedTokens + estimateMessagesTokens(next),
      checkpoint
    }
  };
}
