import { z } from "zod";
import { syncHashSchema, syncIdSchema } from "../connection-schemas";
import {
  conversationSyncBookKeySchema,
  conversationSyncCommitSchema,
  conversationSyncIdSchema,
  conversationSyncRefSchema
} from "./schemas";

const count = z.number().int().nonnegative();

export const conversationSyncConfirmedSchema = z
  .object({
    native: z.enum(["live", "archived", "absent"]),
    ids: z.array(conversationSyncIdSchema)
  })
  .strict();
export const conversationSyncLocalSessionSchema = z
  .object({
    /** The session manifest this device last published. */
    ref: conversationSyncRefSchema.nullable(),
    /** Changes whenever the local session changes; an equal marker skips reading it. */
    marker: z.string().max(512),
    confirmed: conversationSyncConfirmedSchema
  })
  .strict();
export const conversationSyncIssueSchema = z
  .object({
    key: z.string().max(1024),
    title: z.string().max(512),
    code: z.enum([
      "conversationsBusy",
      "conversationsChanged",
      "conversationsFailed",
      "conversationsUnreadable",
      "conversationsWorkMissing"
    ])
  })
  .strict();

/** Per-device conversation sync state; it holds identities and hashes, never message copies. */
export const conversationSyncLocalStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    spaceId: syncIdSchema.nullable(),
    enabledKeys: z.array(conversationSyncBookKeySchema).max(4096),
    published: z
      .object({ hash: syncHashSchema, commit: conversationSyncCommitSchema })
      .strict()
      .nullable(),
    books: z.record(
      conversationSyncBookKeySchema,
      z
        .object({
          sessions: z.record(
            conversationSyncIdSchema,
            conversationSyncLocalSessionSchema
          )
        })
        .strict()
    ),
    /** Remote commits fully merged here; an unchanged commit is not read again. */
    merged: z.record(syncIdSchema, syncHashSchema),
    remoteBooks: z.record(
      conversationSyncBookKeySchema,
      z.object({ sessions: count, bytes: count }).strict()
    ),
    remoteDevices: count,
    lastRun: z
      .object({
        at: z.string().datetime(),
        uploaded: count,
        downloaded: count
      })
      .strict()
      .nullable(),
    issues: z.array(conversationSyncIssueSchema).max(4096)
  })
  .strict();

export type ConversationSyncLocalState = z.infer<
  typeof conversationSyncLocalStateSchema
>;
export type ConversationSyncLocalSession = z.infer<
  typeof conversationSyncLocalSessionSchema
>;
export type ConversationSyncIssue = z.infer<typeof conversationSyncIssueSchema>;

export function emptyConversationSyncState(
  spaceId: string | null,
  enabledKeys: string[] = []
): ConversationSyncLocalState {
  return {
    schemaVersion: 1,
    spaceId,
    enabledKeys,
    published: null,
    books: {},
    merged: {},
    remoteBooks: {},
    remoteDevices: 0,
    lastRun: null,
    issues: []
  };
}
