import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { createId } from "@deepwrite/shared";
import type {
  DeepWriteApi,
  ExtrasAgentOutput,
  ExtrasAgentRunRequest,
  SystemEventEnvelope
} from "@deepwrite/contracts/renderer";

const t = createScopedTranslator("extras.agentRuntime");

export type ExtrasAgentTaskApi = Pick<DeepWriteApi, "extrasAgents" | "session">;

/** Progress hooks; each fires only for events of this task's run. */
export interface ExtrasAgentTaskCallbacks {
  onAccepted?(): void;
  onTurnStarted?(attempt: number): void;
  onRetryScheduled?(delayMs: number): void;
  onThinking?(): void;
  onDelta?(delta: string): void;
  onToolRequested?(toolName: string): void;
  onToolCompleted?(toolName: string, isError: boolean): void;
  onOutput?(output: ExtrasAgentOutput): void;
  onSubagentEvent?(
    event: Extract<
      SystemEventEnvelope,
      {
        type:
          | "subagent.planned"
          | "subagent.started"
          | "subagent.activity"
          | "subagent.completed";
      }
    >
  ): void;
}

export type ExtrasAgentTaskOutcome =
  | { status: "completed"; outputs: ExtrasAgentOutput[]; content: string }
  | { status: "stopped" };

export interface ExtrasAgentTaskHandle {
  readonly sessionId: string;
  /** Resolves when the run completes or stops; rejects with a user message. */
  readonly outcome: Promise<ExtrasAgentTaskOutcome>;
  handleEvent(event: SystemEventEnvelope): void;
  /** Rejects when the abort fails; the run then keeps going. */
  stop(): Promise<void>;
  /** Aborts silently and ignores any later event. */
  dispose(): void;
}

/**
 * Runs one "更多功能" agent task in its own session. Owns the run lifecycle
 * every extras page shares: acceptance races, event filtering, stopping,
 * disposal and Agent Utility restarts.
 */
export function startExtrasAgentTask(
  api: ExtrasAgentTaskApi,
  request: Omit<ExtrasAgentRunRequest, "sessionId">,
  callbacks: ExtrasAgentTaskCallbacks = {}
): ExtrasAgentTaskHandle {
  const sessionId = createId(
    `${request.task.agentId.replaceAll("-", "_")}_session`
  );
  const outputs: ExtrasAgentOutput[] = [];
  let runId: string | undefined;
  let stopping = false;
  let disposed = false;
  let settled = false;
  let resolveOutcome!: (outcome: ExtrasAgentTaskOutcome) => void;
  let rejectOutcome!: (error: Error) => void;
  const outcome = new Promise<ExtrasAgentTaskOutcome>((resolve, reject) => {
    resolveOutcome = resolve;
    rejectOutcome = reject;
  });
  // Callers may attach their handler after an early synchronous failure.
  outcome.catch(() => undefined);

  function finish(result: ExtrasAgentTaskOutcome | Error): void {
    if (settled) return;
    settled = true;
    if (result instanceof Error) rejectOutcome(result);
    else resolveOutcome(result);
  }

  function failure(cause: unknown, fallback: () => string): Error {
    if (cause instanceof Error) return cause;
    // Keep the diagnostic payload intact and resolve the UI message on display.
    return Object.defineProperty(new Error("", { cause }), "message", {
      configurable: true,
      get: () => formatError(cause, fallback())
    });
  }

  async function abortAccepted(): Promise<void> {
    if (runId) await api.session.abort({ sessionId, runId });
  }

  void api.extrasAgents.run({ ...request, sessionId }).then(
    async (accepted) => {
      if (disposed) {
        await api.session
          .abort({ sessionId, runId: accepted.runId })
          .catch(() => undefined);
        return;
      }
      if (settled) return;
      runId = accepted.runId;
      callbacks.onAccepted?.();
      if (!stopping) return;
      try {
        await abortAccepted();
        finish({ status: "stopped" });
      } catch (cause: unknown) {
        finish(failure(cause, () => t("stopFailed")));
      }
    },
    (cause: unknown) => {
      if (stopping) finish({ status: "stopped" });
      else finish(failure(cause, () => t("startFailed")));
    }
  );

  function handleEvent(event: SystemEventEnvelope): void {
    if (settled) return;
    if (
      (event.type === "system.worker_restarting" ||
        event.type === "system.worker_restarted") &&
      event.payload.worker === "agent"
    ) {
      finish(failure(undefined, () => t("processRestarted")));
      return;
    }
    if (
      !("sessionId" in event.payload) ||
      event.payload.sessionId !== sessionId
    )
      return;
    if ("runId" in event.payload) {
      if (runId && event.payload.runId !== runId) return;
      runId = event.payload.runId;
    }
    if (stopping) {
      if (
        event.type === "agent.message_completed" ||
        event.type === "agent.error"
      )
        finish({ status: "stopped" });
      return;
    }
    switch (event.type) {
      case "subagent.planned":
      case "subagent.started":
      case "subagent.activity":
      case "subagent.completed":
        callbacks.onSubagentEvent?.(event);
        break;
      case "agent.turn_started":
        callbacks.onTurnStarted?.(event.payload.attempt);
        break;
      case "agent.retry_scheduled":
        callbacks.onRetryScheduled?.(event.payload.delayMs);
        break;
      case "agent.thinking_delta":
        callbacks.onThinking?.();
        break;
      case "agent.message_delta":
        callbacks.onDelta?.(event.payload.delta);
        break;
      case "tool.call_requested":
        callbacks.onToolRequested?.(event.payload.toolName);
        break;
      case "tool.execution_completed":
        callbacks.onToolCompleted?.(
          event.payload.toolName,
          event.payload.isError
        );
        break;
      case "extras_agent.output_updated":
        outputs.push(event.payload.output);
        callbacks.onOutput?.(event.payload.output);
        break;
      case "agent.error":
        finish(new Error(event.payload.message, { cause: event.payload }));
        break;
      case "agent.message_completed":
        finish(
          event.payload.stopReason === "aborted"
            ? { status: "stopped" }
            : {
                status: "completed",
                outputs,
                content: event.payload.content ?? ""
              }
        );
        break;
    }
  }

  return {
    sessionId,
    outcome,
    handleEvent,
    async stop() {
      if (settled || stopping) return;
      stopping = true;
      if (!runId) return; // Aborted as soon as the run is accepted.
      try {
        await abortAccepted();
        finish({ status: "stopped" });
      } catch (cause: unknown) {
        // The run may have ended on its own while the abort was in flight.
        if (settled) return;
        stopping = false;
        throw failure(cause, () => t("stopFailed"));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const active = !settled;
      finish({ status: "stopped" });
      if (active && runId)
        void api.session.abort({ sessionId, runId }).catch(() => undefined);
    }
  };
}
