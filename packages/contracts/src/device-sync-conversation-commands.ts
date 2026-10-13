import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  ConversationHistoryIdSchema,
  ConversationHistoryKeySchema,
  ConversationHistoryRecordSchema
} from "./conversation-history-mutations";

const RevisionSchema = z.number().int().nonnegative();
const TimeSchema = z.string().min(1).max(64);

export const DeviceSyncConversationSessionWriteSchema = z
  .object({
    sessionId: ConversationHistoryIdSchema,
    /** Revision read during export; null when the session must not exist yet. */
    expectedRevision: RevisionSchema.nullable(),
    createdAt: TimeSchema,
    updatedAt: TimeSchema,
    restore: z.boolean(),
    archive: z.boolean(),
    remove: z.array(ConversationHistoryIdSchema).max(100_000),
    put: z
      .array(
        z
          .object({
            id: ConversationHistoryIdSchema,
            value: ConversationHistoryRecordSchema
          })
          .strict()
      )
      .max(100_000),
    /** Final order of every kept message; local unfinished messages stay last. */
    order: z.array(ConversationHistoryIdSchema).max(100_000)
  })
  .strict();
export type DeviceSyncConversationSessionWrite = z.infer<
  typeof DeviceSyncConversationSessionWriteSchema
>;

/** Main reads and writes whole conversation sessions in Core for device sync. */
export const DeviceSyncConversationCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("deviceSync.conversations"),
    payload: z.discriminatedUnion("operation", [
      z
        .object({
          operation: z.literal("inventory"),
          keys: z.array(ConversationHistoryKeySchema).max(4096)
        })
        .strict(),
      z
        .object({
          operation: z.literal("export"),
          key: ConversationHistoryKeySchema,
          sessionIds: z.array(ConversationHistoryIdSchema).min(1).max(200)
        })
        .strict(),
      z
        .object({
          operation: z.literal("apply"),
          key: ConversationHistoryKeySchema,
          sessions: z
            .array(DeviceSyncConversationSessionWriteSchema)
            .min(1)
            .max(200)
        })
        .strict()
    ])
  });
export type DeviceSyncConversationRequest = z.infer<
  typeof DeviceSyncConversationCommandEnvelopeSchema
>["payload"];

export const DeviceSyncConversationInventorySchema = z
  .object({
    scopes: z.record(
      ConversationHistoryKeySchema,
      z
        .object({
          sessions: z.array(
            z
              .object({
                sessionId: ConversationHistoryIdSchema,
                revision: RevisionSchema,
                deleted: z.boolean(),
                messageCount: RevisionSchema
              })
              .strict()
          )
        })
        .strict()
    )
  })
  .strict();
export const DeviceSyncConversationExportSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          sessionId: ConversationHistoryIdSchema,
          revision: RevisionSchema,
          deleted: z.boolean(),
          metadata: ConversationHistoryRecordSchema,
          messages: z.array(
            z
              .object({
                id: ConversationHistoryIdSchema,
                value: ConversationHistoryRecordSchema
              })
              .strict()
          )
        })
        .strict()
    )
  })
  .strict();
export const DeviceSyncConversationApplyResultSchema = z
  .object({
    results: z.array(
      z
        .object({
          sessionId: ConversationHistoryIdSchema,
          status: z.enum(["applied", "changed", "busy"]),
          revision: RevisionSchema.nullable()
        })
        .strict()
    )
  })
  .strict();
export type DeviceSyncConversationInventory = z.infer<
  typeof DeviceSyncConversationInventorySchema
>;
export type DeviceSyncConversationExport = z.infer<
  typeof DeviceSyncConversationExportSchema
>;
export type DeviceSyncConversationApplyResult = z.infer<
  typeof DeviceSyncConversationApplyResultSchema
>;

/**
 * Before writing a book's conversations, Main asks the window to save and hold the ones it has open; the
 * window answers with the logical keys it released. Afterwards Main reports which keys changed.
 */
export const DeviceSyncConversationLeaseEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("deviceSync.conversationLease"),
    payload: z.object({ keys: z.array(z.string().min(1).max(1024)).max(4096) })
  });
export const DeviceSyncConversationsChangedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("deviceSync.conversationsChanged"),
    payload: z.object({
      requestId: z.string().min(1).max(120),
      changed: z.array(z.string().min(1).max(1024)).max(4096)
    })
  });
export const DeviceSyncConversationLeaseResultCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("deviceSync.conversationLeaseResult"),
    payload: z
      .object({
        requestId: z.string().min(1).max(120),
        released: z.array(z.string().min(1).max(1024)).max(4096)
      })
      .strict()
  });
