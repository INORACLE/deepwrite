import {
  bookConversationLogicalKey,
  conversationHistoryKeyFor,
  DeviceSyncConversationApplyResultSchema,
  DeviceSyncConversationExportSchema,
  DeviceSyncConversationInventorySchema,
  type DeviceSyncConversationRequest,
  type DeviceSyncConversationSessionWrite
} from "@deepwrite/contracts";
import type {
  ConversationBookPort,
  LocalConversationSession
} from "./book-sync";
import {
  desktopMessageRecord,
  desktopMessageValue,
  desktopRemote
} from "./desktop-records";

const BATCH_SESSIONS = 50;
const marker = (revision: number) => `r${revision}`;
function time(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}
function batches<T>(items: T[], size = BATCH_SESSIONS): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

/** A work's conversations in Core's storage, converted to and from the exchange format. */
export function desktopConversationPort(
  syncKey: string,
  request: (payload: DeviceSyncConversationRequest) => Promise<unknown>,
  now: () => string
): ConversationBookPort & { logicalKey: string } {
  const logicalKey = bookConversationLogicalKey(syncKey);
  if (!logicalKey) throw new Error("该作品不支持对话同步。");
  const key = conversationHistoryKeyFor(logicalKey);
  return {
    logicalKey,
    archivedStatus: "archived",
    async inventory() {
      const inventory = DeviceSyncConversationInventorySchema.parse(
        await request({ operation: "inventory", keys: [key] })
      );
      return (inventory.scopes[key]?.sessions ?? []).map((session) => ({
        id: session.sessionId,
        marker: marker(session.revision)
      }));
    },
    async read(ids) {
      const sessions: LocalConversationSession[] = [];
      for (const sessionIds of batches(ids)) {
        const exported = DeviceSyncConversationExportSchema.parse(
          await request({ operation: "export", key, sessionIds })
        );
        for (const session of exported.sessions)
          sessions.push({
            id: session.sessionId,
            marker: marker(session.revision),
            createdAt:
              time(session.metadata.createdAt) ??
              time(session.messages[0]?.value.createdAt) ??
              now(),
            deleted: session.deleted,
            messages: session.messages.map(({ id, value }) => ({
              id,
              createdAt: time(value.createdAt) ?? now(),
              record: value.id === id ? desktopMessageRecord(value) : null,
              foreignHash: desktopRemote(value)?.recordHash
            }))
          });
      }
      return sessions;
    },
    async apply(writes) {
      const outcomes = [];
      for (const group of batches(writes)) {
        const sessions: DeviceSyncConversationSessionWrite[] = group.map(
          (write) => ({
            sessionId: write.id,
            expectedRevision: write.expectedMarker
              ? Number(write.expectedMarker.slice(1))
              : null,
            createdAt: write.createdAt,
            updatedAt: write.updatedAt,
            restore: write.restore,
            archive: write.archive,
            remove: write.remove,
            put: write.put.map((entry) => ({
              id: entry.record.id,
              value: desktopMessageValue(entry.record, entry.hash, entry.device)
            })) as DeviceSyncConversationSessionWrite["put"],
            order: write.order
          })
        );
        const result = DeviceSyncConversationApplyResultSchema.parse(
          await request({ operation: "apply", key, sessions })
        );
        outcomes.push(
          ...result.results.map((entry) => ({
            id: entry.sessionId,
            status: entry.status,
            marker: entry.revision === null ? null : marker(entry.revision)
          }))
        );
      }
      return outcomes;
    }
  };
}
