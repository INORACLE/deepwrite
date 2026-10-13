import {
  CONVERSATION_SYNC_RECORD_MAX_CHARS,
  conversationSyncAttachmentSchema,
  conversationSyncCompactionSchema,
  conversationSyncMessageSchema,
  conversationSyncProposalSchema,
  conversationSyncRemoteSchema,
  conversationSyncStepSchema,
  conversationSyncSubagentSchema,
  conversationSyncToolSchema,
  stableSyncJson,
  type ConversationSyncMessage,
  type ConversationSyncRemote
} from "@deepwrite/contracts";

type Json = Record<string, unknown>;
type Proposal = NonNullable<ConversationSyncMessage["proposals"]>[number];
type Subagent = NonNullable<ConversationSyncMessage["subagents"]>[number];

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max?: number): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return max === undefined ? value : value.slice(0, max);
}
function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(record) : [];
}
/** Keeps the entries the exchange format accepts, so one odd entry does not drop the message. */
function valid<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
  items: unknown[]
): T[] | undefined {
  const kept = items.flatMap((item) => {
    const parsed = schema.safeParse(JSON.parse(stableSyncJson(item)));
    return parsed.success ? [parsed.data] : [];
  });
  return kept.length ? kept : undefined;
}
function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** The record a message was received from; such messages are re-published unchanged. */
export function desktopRemote(value: Json): ConversationSyncRemote | null {
  const parsed = conversationSyncRemoteSchema.safeParse(value.remote);
  return parsed.success ? parsed.data : null;
}

function proposalStatus(value: Json): Proposal["status"] {
  if (record(value.discardState) && value.discardState.status === "discarded")
    return "discarded";
  const status = String(value.status);
  if (status === "accepting") return "pending";
  return ["pending", "accepted", "rejected", "conflict", "error"].includes(
    status
  )
    ? (status as Proposal["status"])
    : "error";
}
function subagentStatus(value: unknown): Subagent["status"] {
  if (value === "completed" || value === "error" || value === "skipped")
    return value;
  return "stopped";
}

/**
 * Converts a stored desktop chat message to the exchange record. Returns null for a message that is still
 * running or cannot be represented; callers keep such messages local and never treat them as removed.
 */
export function desktopMessageRecord(
  value: Json
): ConversationSyncMessage | null {
  if (value.status === "streaming") return null;
  const remote = desktopRemote(value);
  const runtime = record(value.runtime) ? value.runtime : {};
  const model = {
    configId: text(runtime.configId, 120),
    provider: text(runtime.provider, 120),
    model: text(runtime.model, 240)
  };
  const usage = record(value.usage) ? value.usage : null;
  const message: Json = {
    schemaVersion: 1,
    kind: "deepwrite.conversation-message",
    id: value.id,
    role: value.role,
    content: typeof value.content === "string" ? value.content : "",
    createdAt: value.createdAt,
    status:
      value.status === "stopped" || value.status === "error"
        ? value.status
        : "completed",
    runId: text(value.runId),
    errorMessage: text(value.errorMessage, 4000),
    model: Object.values(model).some(Boolean) ? model : undefined,
    thinking: text(value.thinking),
    steps: valid(
      conversationSyncStepSchema,
      list(value.processingSteps).map((step) => ({
        id: step.id,
        type: step.type,
        content: step.content,
        toolCallId: step.toolCallId,
        compactionId: step.compactionId,
        createdAt: step.createdAt
      }))
    ),
    tools: valid(
      conversationSyncToolSchema,
      list(value.toolCalls).map((tool) => ({
        id: tool.id,
        name: String(tool.name ?? "").slice(0, 120),
        status:
          tool.status === "completed" || tool.status === "error"
            ? tool.status
            : "stopped",
        inputSummary: text(
          typeof tool.argumentsText === "string"
            ? tool.argumentsText
            : tool.args === undefined
              ? undefined
              : JSON.stringify(tool.args),
          4000
        ),
        resultSummary: text(tool.resultSummary, 4000)
      }))
    ),
    proposals: valid(conversationSyncProposalSchema, [
      ...list(value.editProposals).map((proposal): Proposal => ({
        id: String(proposal.id),
        title: String(proposal.title ?? "").slice(0, 512),
        summary: String(proposal.summary ?? "").slice(0, 4000),
        status: proposalStatus(proposal),
        additions: count(proposal.additions),
        deletions: count(proposal.deletions)
      })),
      ...(remote?.proposals ?? [])
    ]),
    subagents: valid(conversationSyncSubagentSchema, [
      ...list(value.subagentRuns).map((run): Subagent => ({
        id: String(run.subagentRunId ?? run.parentToolCallId),
        name: String(run.name ?? run.subagentId ?? "子智能体").slice(0, 240),
        status: subagentStatus(run.status),
        ...(text(run.task, 4000) ? { task: text(run.task, 4000) } : {}),
        ...(text(run.summary, 4000)
          ? { summary: text(run.summary, 4000) }
          : {}),
        ...(text(run.output) ? { output: text(run.output) } : {})
      })),
      ...(remote?.subagents ?? [])
    ]),
    compactions: valid(conversationSyncCompactionSchema, [
      ...list(value.contextCompactions).flatMap((compaction) =>
        record(compaction.checkpoint) &&
        typeof compaction.checkpoint.summary === "string" &&
        compaction.checkpoint.summary
          ? [
              {
                id: compaction.id,
                summary: compaction.checkpoint.summary,
                createdAt: compaction.createdAt
              }
            ]
          : []
      ),
      ...(remote?.compactions ?? [])
    ]),
    attachments: valid(
      conversationSyncAttachmentSchema,
      list(value.attachments).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
        mediaType: attachment.mediaType,
        size: attachment.size
      }))
    ),
    usage:
      usage &&
      [
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "totalTokens"
      ].every((key) => count(usage[key]) === usage[key])
        ? usage
        : undefined
  };
  return fitRecord(message);
}

/** Display details give way first when a record would exceed the transfer limit. */
function fitRecord(message: Json): ConversationSyncMessage | null {
  const parsed = conversationSyncMessageSchema.safeParse(
    JSON.parse(stableSyncJson(message))
  );
  if (!parsed.success) return null;
  if (stableSyncJson(parsed.data).length <= CONVERSATION_SYNC_RECORD_MAX_CHARS)
    return parsed.data;
  const {
    thinking: _thinking,
    steps: _steps,
    tools: _tools,
    subagents: _subagents,
    compactions: _compactions,
    ...rest
  } = parsed.data;
  const reduced: ConversationSyncMessage = { ...rest, detailsOmitted: true };
  return stableSyncJson(reduced).length <= CONVERSATION_SYNC_RECORD_MAX_CHARS
    ? reduced
    : null;
}

/** The stored desktop message for a record received from another device. */
export function desktopMessageValue(
  message: ConversationSyncMessage,
  recordHash: string,
  device: string
): Json {
  const tools = message.tools ?? [];
  const remote: ConversationSyncRemote = {
    recordHash,
    device,
    ...(message.proposals ? { proposals: message.proposals } : {}),
    ...(message.subagents ? { subagents: message.subagents } : {}),
    ...(message.compactions ? { compactions: message.compactions } : {})
  };
  return JSON.parse(
    stableSyncJson({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      status: message.status,
      runId: message.runId,
      errorMessage: message.errorMessage,
      runtime:
        message.model?.provider && message.model.model
          ? {
              provider: message.model.provider,
              model: message.model.model,
              mode: "provider",
              configId: message.model.configId
            }
          : undefined,
      thinking: message.thinking,
      processingSteps: message.steps,
      toolCalls: tools.length
        ? tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            args: {},
            argumentsText: tool.inputSummary,
            argumentsComplete: true,
            status: tool.status === "completed" ? "completed" : "error",
            requestedAt: message.createdAt,
            completedAt: message.createdAt,
            resultSummary: tool.resultSummary,
            isError: tool.status !== "completed"
          }))
        : undefined,
      attachments: message.attachments,
      usage: message.usage,
      remote
    })
  ) as Json;
}
