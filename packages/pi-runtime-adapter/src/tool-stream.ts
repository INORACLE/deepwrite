import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model
} from "@earendil-works/pi-ai";

export type ToolCallAssistantEvent = Extract<
  AssistantMessageEvent,
  { type: "toolcall_start" | "toolcall_delta" | "toolcall_end" }
>;

/**
 * Observes provider tool-call chunks before pi-agent-core processes or executes
 * the completed tool. This keeps UI activity tied to the raw model stream.
 */
export function interceptToolCallStream(
  sourceStreamFn: StreamFn,
  onToolCallEvent: (
    event: ToolCallAssistantEvent,
    assistantTurnIndex: number
  ) => void
): StreamFn {
  let assistantTurnIndex = 0;
  return (model, context, options) => {
    const currentTurnIndex = assistantTurnIndex;
    assistantTurnIndex += 1;
    return observeAssistantStream(sourceStreamFn, (event) => {
      if (
        event.type === "toolcall_start" ||
        event.type === "toolcall_delta" ||
        event.type === "toolcall_end"
      ) {
        onToolCallEvent(event, currentTurnIndex);
      }
    })(model, context, {
      ...options,
      // DeepWrite owns the visible retry lifecycle. Prevent an SDK retry
      // budget from multiplying the adapter's attempt budget.
      maxRetries: 0
    });
  };
}

/** Observe normalized events before their messages enter the Agent transcript. */
export function observeAssistantStream(
  sourceStreamFn: StreamFn,
  onEvent: (event: AssistantMessageEvent) => void
): StreamFn {
  return async (model, context, options) => {
    const forwarded = createAssistantMessageEventStream();
    void (async () => {
      let partialMessage: AssistantMessage | undefined;
      let terminalSeen = false;
      try {
        const source = await sourceStreamFn(model, context, options);
        for await (const event of source) {
          if ("partial" in event) {
            partialMessage = event.partial;
          }
          onEvent(event);
          if (event.type === "done" || event.type === "error") {
            terminalSeen = true;
          }
          forwarded.push(event);
        }
        if (!terminalSeen) {
          forwarded.push({
            type: "error",
            reason: options?.signal?.aborted ? "aborted" : "error",
            error: createStreamFailureMessage(
              model,
              partialMessage,
              options?.signal?.aborted
                ? "模型请求已中止。"
                : "Model stream ended without a terminal event.",
              options?.signal?.aborted === true
            )
          });
        }
      } catch (error: unknown) {
        const aborted = options?.signal?.aborted === true;
        forwarded.push({
          type: "error",
          reason: aborted ? "aborted" : "error",
          error: createStreamFailureMessage(
            model,
            partialMessage,
            aborted
              ? "模型请求已中止。"
              : error instanceof Error
                ? error.message
                : String(error),
            aborted
          )
        });
      }
    })();
    return forwarded;
  };
}

function createStreamFailureMessage(
  model: Model<Api>,
  partialMessage: AssistantMessage | undefined,
  errorMessage: string,
  aborted: boolean
): AssistantMessage {
  return {
    role: "assistant",
    content: partialMessage?.content ?? [{ type: "text", text: "" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: partialMessage?.usage ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: aborted ? "aborted" : "error",
    errorMessage,
    timestamp: Date.now()
  };
}
