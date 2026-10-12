import { reactive, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { STREAM_PRESENTATION_FALLBACK_MS } from "../../composables/agent-conversation/shared";
import {
  handleSubagentEvent,
  handleSubagentPlanned
} from "../../composables/agent-conversation/subagent-events";
import {
  earlierTimestamp,
  ensureSubagentRun,
  subagentTurnKey
} from "../../composables/agent-conversation/subagent-identity";
import {
  acceptsSubagentRetryActivity,
  handleSubagentRetryScheduled,
  handleSubagentTurnStarted,
  restoreSubagentCheckpoint
} from "../../composables/agent-conversation/subagent-retry";
import { flushPendingSubagentTextDeltas } from "../../composables/agent-conversation/subagent-text-deltas";
import { agentRetryMetadata } from "../../composables/agent-conversation/turn-retry";
import type {
  PendingSubagentTextDelta,
  SubagentTurnCheckpoint
} from "../../composables/agent-conversation/types";
import type { ChatMessage } from "../../types/conversation";
import type { ExtrasAgentTaskCallbacks } from "./extrasAgentTask";

export type SubagentTrackerEvent = Parameters<
  NonNullable<ExtrasAgentTaskCallbacks["onSubagentEvent"]>
>[0];

/** What the lead agent of the current run is doing between delegations. */
export type SubagentParentActivity =
  | { kind: "idle" }
  | { kind: "thinking" | "replying" }
  | { kind: "tool"; toolName: string }
  | { kind: "retry"; retryAt: number };

/** One run of the lead agent and the children it delegated to. */
export interface TrackedSubagentPackage {
  readonly id: string;
  readonly phase: string;
  readonly unitIds: readonly string[];
  readonly startedAt: string;
  endedAt?: string;
  outcome?: "completed" | "stopped" | "failed";
  /** Why a package that failed never delegated anything. */
  failureReason?: string;
  /** Holds the child runs as `subagentRuns`, like a conversation message. */
  message: ChatMessage;
}

type TrackerContext = Parameters<typeof handleSubagentEvent>[0] &
  Parameters<typeof handleSubagentPlanned>[0] &
  Parameters<typeof handleSubagentTurnStarted>[0] &
  Parameters<typeof acceptsSubagentRetryActivity>[0] &
  Parameters<typeof ensureSubagentRun>[0];

export interface SubagentRunTracker {
  /** Newest first; reactive deep, so a dialog on a run follows its stream. */
  readonly packages: ShallowRef<readonly TrackedSubagentPackage[]>;
  readonly parent: Ref<SubagentParentActivity>;
  /** Hooks for `startExtrasAgentTask` that keep `parent` current. */
  readonly parentCallbacks: Pick<
    ExtrasAgentTaskCallbacks,
    | "onTurnStarted"
    | "onRetryScheduled"
    | "onThinking"
    | "onDelta"
    | "onToolRequested"
    | "onToolCompleted"
  >;
  begin(meta: { phase: string; unitIds: readonly string[] }): void;
  handleEvent(event: SubagentTrackerEvent): void;
  /** Settles children that never reported an end and stops the clock. */
  end(outcome: "completed" | "stopped" | "failed", reason?: string): void;
  reset(): void;
  dispose(): void;
}

/**
 * Follows the children of extras agent runs with the reducer the chat uses
 * for delegated tasks, so cards, details and retries behave the same. Keeps
 * only the latest packages: tool arguments of submissions can be large.
 */
export function createSubagentRunTracker(
  options: { keepPackages?: number } = {}
): SubagentRunTracker {
  const keep = options.keepPackages ?? 3;
  const packages = shallowRef<readonly TrackedSubagentPackage[]>([]);
  const parent = ref<SubagentParentActivity>({ kind: "idle" });
  const pendingDeltas = new Map<string, PendingSubagentTextDelta>();
  const checkpoints = new Map<string, SubagentTurnCheckpoint>();
  const seenTurns = new Set<string>();
  let current: TrackedSubagentPackage | undefined;
  let sequence = 0;
  let frame: number | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  function flushNow() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (fallback !== undefined) clearTimeout(fallback);
    frame = fallback = undefined;
    flushPendingSubagentTextDeltas(ctx);
  }
  // Parallel children stream at once: apply their text once per frame.
  function schedule() {
    if (frame !== undefined || fallback !== undefined) return;
    if (typeof requestAnimationFrame !== "function") return flushNow();
    frame = requestAnimationFrame(flushNow);
    // Hidden windows pause animation frames.
    fallback = setTimeout(flushNow, STREAM_PRESENTATION_FALLBACK_MS);
  }
  const ctx: TrackerContext = {
    pendingSubagentTextDeltas: pendingDeltas,
    subagentTurnCheckpointByRun: checkpoints,
    seenSubagentTurnIds: seenTurns,
    messageMutations: {
      appendText(target, key, text) {
        const record = target as Record<string, string | undefined>;
        record[key] = `${record[key] ?? ""}${text}`;
      }
    },
    scheduleStreamPresentation: schedule,
    subagentTurnKey: (runId, subagentRunId) =>
      subagentTurnKey(ctx, runId, subagentRunId),
    earlierTimestamp: (a, b) => earlierTimestamp(ctx, a, b),
    retryMetadata: agentRetryMetadata,
    ensureSubagentMessage(runId) {
      const message = current!.message;
      message.runId ??= runId;
      return message;
    },
    ensureSubagentRun(message, payload, timestamp, task) {
      const run = ensureSubagentRun(ctx, message, payload, timestamp, task);
      // Hand out the reactive proxy, so later writes reach the views.
      return (
        message.subagentRuns?.find(
          ({ subagentRunId }) => subagentRunId === run.subagentRunId
        ) ?? run
      );
    },
    restoreSubagentCheckpoint: (run, checkpoint, retry, runtime) =>
      restoreSubagentCheckpoint(ctx, run, checkpoint, retry, runtime),
    handleSubagentTurnStarted: (event, run, activity) =>
      handleSubagentTurnStarted(ctx, event, run, activity),
    handleSubagentRetryScheduled: (event, run, activity) =>
      handleSubagentRetryScheduled(ctx, event, run, activity),
    acceptsSubagentRetryActivity: (event, run) =>
      acceptsSubagentRetryActivity(ctx, event, run)
  };

  function setParent(next: SubagentParentActivity) {
    const now = parent.value;
    if (
      now.kind === next.kind &&
      (now as { toolName?: string }).toolName ===
        (next as { toolName?: string }).toolName
    )
      return;
    parent.value = next;
  }
  function forget() {
    pendingDeltas.clear();
    checkpoints.clear();
    seenTurns.clear();
  }
  function end(outcome: "completed" | "stopped" | "failed", reason?: string) {
    flushNow();
    setParent({ kind: "idle" });
    if (!current || current.endedAt) return;
    const at = new Date().toISOString();
    for (const run of current.message.subagentRuns ?? []) {
      if (run.status !== "queued" && run.status !== "running") continue;
      run.status = outcome === "failed" && reason ? "error" : "stopped";
      run.completedAt = at;
      delete run.retry;
      if (outcome === "failed" && reason) run.errorMessage = reason;
    }
    current.message.status =
      outcome === "failed"
        ? "error"
        : outcome === "stopped"
          ? "stopped"
          : "completed";
    current.message.processingCompletedAt = at;
    current.endedAt = at;
    current.outcome = outcome;
    if (outcome === "failed" && reason) current.failureReason = reason;
    forget();
  }
  return {
    packages,
    parent,
    parentCallbacks: {
      onTurnStarted: () => setParent({ kind: "thinking" }),
      onThinking: () => setParent({ kind: "thinking" }),
      onDelta: () => setParent({ kind: "replying" }),
      onToolRequested: (toolName) => setParent({ kind: "tool", toolName }),
      onToolCompleted: () => setParent({ kind: "thinking" }),
      onRetryScheduled: (delayMs) =>
        setParent({ kind: "retry", retryAt: Date.now() + delayMs })
    },
    begin({ phase, unitIds }) {
      if (current && !current.endedAt) end("stopped");
      forget();
      const startedAt = new Date().toISOString();
      const id = `package_${++sequence}`;
      current = reactive<TrackedSubagentPackage>({
        id,
        phase,
        unitIds: [...unitIds],
        startedAt,
        message: {
          id,
          role: "assistant",
          content: "",
          createdAt: startedAt,
          status: "streaming",
          activityOnly: true,
          toolCalls: [],
          processingSteps: [],
          subagentRuns: []
        }
      });
      // A package that ended without delegating anything (a busy model slot,
      // a retry) has nothing to show once the next one starts.
      const kept = packages.value.filter(
        (pkg) => !pkg.endedAt || pkg.message.subagentRuns?.length
      );
      packages.value = [current, ...kept].slice(0, keep);
      setParent({ kind: "thinking" });
    },
    handleEvent(event) {
      if (!current) return;
      const text =
        event.type === "subagent.activity" &&
        (event.payload.activity.type === "thinking_delta" ||
          event.payload.activity.type === "message_delta");
      // Anything but streamed text keeps its order behind earlier text.
      if (!text) flushNow();
      if (event.type === "subagent.planned") handleSubagentPlanned(ctx, event);
      else handleSubagentEvent(ctx, event);
    },
    end,
    reset() {
      flushNow();
      forget();
      current = undefined;
      packages.value = [];
      setParent({ kind: "idle" });
    },
    dispose() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (fallback !== undefined) clearTimeout(fallback);
      frame = fallback = undefined;
      forget();
      current = undefined;
      packages.value = [];
    }
  };
}
