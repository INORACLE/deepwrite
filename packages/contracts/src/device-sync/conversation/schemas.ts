import { z } from "zod";
import { syncHashSchema, syncIdSchema } from "../connection-schemas";

/**
 * Conversation exchange format shared byte for byte with the phone app
 * (`deepwrite-app/src/core/device-sync/conversation`). Records and manifests
 * live in the sync space's content packs; changing a field needs both apps.
 */
export const CONVERSATION_SYNC_ID_MAX = 240;
export const CONVERSATION_SYNC_RECORD_MAX_CHARS = 8 * 1024 * 1024;

const finiteTime = (value: string) => Number.isFinite(Date.parse(value));
export const conversationSyncIdSchema = z
  .string()
  .min(1)
  .max(CONVERSATION_SYNC_ID_MAX);
export const conversationSyncTimeSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(finiteTime, "Invalid conversation time.");
export const conversationSyncBookKeySchema = z
  .string()
  .max(1024)
  .refine(
    (key) => /^(book|long-book):[^:]/.test(key),
    "Conversations sync only for short, script and long works."
  );
export const conversationSyncRefSchema = z
  .object({ hash: syncHashSchema, pack: syncHashSchema })
  .strict();

const count = z.number().int().nonnegative();
const id = conversationSyncIdSchema;
const time = conversationSyncTimeSchema;

export const conversationSyncStepSchema = z.discriminatedUnion("type", [
  z
    .object({
      id,
      type: z.literal("thinking"),
      content: z.string(),
      createdAt: time
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal("response"),
      content: z.string(),
      createdAt: time
    })
    .strict(),
  z
    .object({ id, type: z.literal("tool"), toolCallId: id, createdAt: time })
    .strict(),
  z
    .object({
      id,
      type: z.literal("compaction"),
      compactionId: id,
      createdAt: time
    })
    .strict()
]);
export const conversationSyncToolSchema = z
  .object({
    id,
    name: z.string().min(1).max(120),
    status: z.enum(["completed", "error", "stopped"]),
    inputSummary: z.string().max(4000).optional(),
    resultSummary: z.string().max(4000).optional()
  })
  .strict();
export const conversationSyncProposalSchema = z
  .object({
    id,
    title: z.string().max(512),
    summary: z.string().max(4000),
    status: z.enum([
      "pending",
      "accepted",
      "rejected",
      "conflict",
      "error",
      "discarded"
    ]),
    additions: count,
    deletions: count
  })
  .strict();
export const conversationSyncSubagentSchema = z
  .object({
    id,
    name: z.string().min(1).max(240),
    /** The delegating call; its card is shown where the call was made. */
    toolCallId: id.optional(),
    status: z.enum(["completed", "error", "stopped", "skipped"]),
    task: z.string().max(4000).optional(),
    summary: z.string().max(4000).optional(),
    output: z.string().optional()
  })
  .strict();
export const conversationSyncCompactionSchema = z
  .object({ id, summary: z.string().min(1), createdAt: time })
  .strict();
export const conversationSyncAttachmentSchema = z
  .object({
    id,
    name: z.string().min(1).max(512),
    kind: z.enum(["text", "image"]),
    mediaType: z.string().min(1).max(255),
    size: count
  })
  .strict();
export const conversationSyncUsageSchema = z
  .object({
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
    totalTokens: count
  })
  .strict();
export const conversationSyncModelSchema = z
  .object({
    configId: z.string().min(1).max(120).optional(),
    provider: z.string().min(1).max(120).optional(),
    model: z.string().min(1).max(240).optional()
  })
  .strict();

/** One finished message. Only the device that wrote a message changes it. */
export const conversationSyncMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("deepwrite.conversation-message"),
    id,
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    createdAt: time,
    status: z.enum(["completed", "stopped", "error"]),
    runId: id.optional(),
    errorMessage: z.string().max(4000).optional(),
    model: conversationSyncModelSchema.optional(),
    thinking: z.string().optional(),
    steps: z.array(conversationSyncStepSchema).max(4096).optional(),
    tools: z.array(conversationSyncToolSchema).max(1024).optional(),
    proposals: z.array(conversationSyncProposalSchema).max(1024).optional(),
    subagents: z.array(conversationSyncSubagentSchema).max(256).optional(),
    compactions: z.array(conversationSyncCompactionSchema).max(64).optional(),
    attachments: z.array(conversationSyncAttachmentSchema).max(32).optional(),
    usage: conversationSyncUsageSchema.optional(),
    /** Display details were dropped to keep the record within its size limit. */
    detailsOmitted: z.literal(true).optional()
  })
  .strict();

export const conversationSyncEntrySchema = z
  .object({
    id,
    /** The message this one followed when it was written; never changes. */
    parent: id.nullable(),
    createdAt: time,
    record: conversationSyncRefSchema,
    bytes: count,
    /** When the writing device last changed the record. */
    at: time
  })
  .strict();
export const conversationSyncRemovalSchema = z
  .object({ id, at: time })
  .strict();
export const conversationSyncStateSchema = z
  .object({ deleted: z.boolean(), at: time })
  .strict();

export const conversationSyncSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("deepwrite.conversation-session"),
    id,
    createdAt: time,
    state: conversationSyncStateSchema,
    messages: z.array(conversationSyncEntrySchema),
    removed: z.array(conversationSyncRemovalSchema)
  })
  .strict()
  .refine((session) => {
    const ids = session.messages.map((entry) => entry.id);
    const removed = new Set(session.removed.map((entry) => entry.id));
    return (
      new Set(ids).size === ids.length &&
      removed.size === session.removed.length &&
      ids.every((value) => !removed.has(value))
    );
  }, "Conversation message identities must be unique.");

export const conversationSyncSessionSummarySchema = z
  .object({
    ref: conversationSyncRefSchema,
    messages: count,
    bytes: count,
    deleted: z.boolean()
  })
  .strict();
export const conversationSyncBookSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("deepwrite.conversation-book"),
    key: conversationSyncBookKeySchema,
    sessions: z.record(id, conversationSyncSessionSummarySchema)
  })
  .strict();
export const conversationSyncBookSummarySchema = z
  .object({ ref: conversationSyncRefSchema, sessions: count, bytes: count })
  .strict();
export const conversationSyncCommitSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("deepwrite.conversation-commit"),
    spaceId: syncIdSchema,
    deviceId: syncIdSchema,
    deviceName: z.string().min(1).max(80),
    sequence: z.number().int().positive(),
    createdAt: z.string().datetime(),
    books: z.record(
      conversationSyncBookKeySchema,
      conversationSyncBookSummarySchema
    ),
    receipts: z.record(syncIdSchema, syncHashSchema)
  })
  .strict();

/**
 * Kept on a local message received from another device: the record it came from, and the read-only details
 * this app has no native place for.
 */
export const conversationSyncRemoteSchema = z
  .object({
    recordHash: syncHashSchema,
    device: z.string().min(1).max(80),
    proposals: z.array(conversationSyncProposalSchema).max(1024).optional(),
    subagents: z.array(conversationSyncSubagentSchema).max(256).optional(),
    compactions: z.array(conversationSyncCompactionSchema).max(64).optional(),
    attachments: z.array(conversationSyncAttachmentSchema).max(32).optional()
  })
  .strict();

export type ConversationSyncRef = z.infer<typeof conversationSyncRefSchema>;
export type ConversationSyncRemote = z.infer<
  typeof conversationSyncRemoteSchema
>;
export type ConversationSyncMessage = z.infer<
  typeof conversationSyncMessageSchema
>;
export type ConversationSyncEntry = z.infer<typeof conversationSyncEntrySchema>;
export type ConversationSyncState = z.infer<typeof conversationSyncStateSchema>;
export type ConversationSyncSession = z.infer<
  typeof conversationSyncSessionSchema
>;
export type ConversationSyncBook = z.infer<typeof conversationSyncBookSchema>;
export type ConversationSyncCommit = z.infer<
  typeof conversationSyncCommitSchema
>;
