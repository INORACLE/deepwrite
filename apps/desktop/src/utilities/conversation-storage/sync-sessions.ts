import { randomUUID } from "node:crypto";
import type {
  ConversationHistoryBatch,
  ConversationHistoryCommitResult,
  ConversationHistoryOperation,
  ConversationHistoryRecord,
  DeviceSyncConversationApplyResult,
  DeviceSyncConversationExport,
  DeviceSyncConversationInventory,
  DeviceSyncConversationSessionWrite
} from "@deepwrite/contracts";
import type { Statements } from "./schema";
import type { JsonNodes, ValueRef } from "./json-nodes";
import { ConversationStorageError } from "./errors";

interface SyncStorage {
  sql: Statements;
  nodes: JsonNodes;
  commit(batch: ConversationHistoryBatch): ConversationHistoryCommitResult;
}
type SessionRow = {
  revision: number;
  generation: number;
  sequence: number;
  deleted: number;
  metadata_ref: string | null;
};

function sessionRow(
  sql: Statements,
  key: string,
  sessionId: string
): SessionRow | undefined {
  return sql
    .get(
      "SELECT revision, generation, sequence, deleted, sessions.metadata_ref FROM sessions JOIN scopes ON scopes.key = sessions.scope_key WHERE scope_key = ? AND session_id = ? AND scopes.removed = 0"
    )
    .get(key, sessionId) as SessionRow | undefined;
}
function messageRows(sql: Statements, key: string, sessionId: string) {
  return sql
    .get(
      "SELECT message_id, position, value_ref, running, pending FROM messages WHERE scope_key = ? AND session_id = ? ORDER BY position, message_id"
    )
    .all(key, sessionId) as {
    message_id: string;
    position: number;
    value_ref: string;
    running: number;
    pending: number;
  }[];
}
function asRecord(value: unknown): ConversationHistoryRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ConversationHistoryRecord)
    : {};
}

export function inventorySyncSessions(
  sql: Statements,
  keys: readonly string[]
): DeviceSyncConversationInventory {
  const scopes: DeviceSyncConversationInventory["scopes"] = {};
  for (const key of keys) {
    const rows = sql
      .get(
        "SELECT session_id, revision, deleted, message_count FROM sessions JOIN scopes ON scopes.key = sessions.scope_key WHERE scope_key = ? AND scopes.removed = 0 ORDER BY session_id"
      )
      .all(key) as {
      session_id: string;
      revision: number;
      deleted: number;
      message_count: number;
    }[];
    scopes[key] = {
      sessions: rows.map((row) => ({
        sessionId: row.session_id,
        revision: Number(row.revision),
        deleted: Boolean(row.deleted),
        messageCount: Number(row.message_count)
      }))
    };
  }
  return { scopes };
}

export function exportSyncSessions(
  sql: Statements,
  nodes: JsonNodes,
  key: string,
  sessionIds: readonly string[]
): DeviceSyncConversationExport {
  const sessions: DeviceSyncConversationExport["sessions"] = [];
  for (const sessionId of sessionIds) {
    const row = sessionRow(sql, key, sessionId);
    if (!row) continue;
    sessions.push({
      sessionId,
      revision: Number(row.revision),
      deleted: Boolean(row.deleted),
      metadata: row.metadata_ref
        ? asRecord(nodes.read(JSON.parse(row.metadata_ref) as ValueRef))
        : {},
      messages: messageRows(sql, key, sessionId).map((message) => ({
        id: message.message_id,
        value: asRecord(nodes.read(JSON.parse(message.value_ref) as ValueRef))
      }))
    });
  }
  return { sessions };
}

function operations(
  write: DeviceSyncConversationSessionWrite,
  existing: ReturnType<typeof messageRows>,
  created: boolean
): ConversationHistoryOperation[] {
  const result: ConversationHistoryOperation[] = [];
  if (created)
    result.push({
      type: "setMetadata",
      value: {
        sessionId: write.sessionId,
        createdAt: write.createdAt,
        updatedAt: write.updatedAt,
        draft: "",
        approvalMode: "request-approval",
        temperature: 0.7
      }
    });
  const remove = new Set(write.remove);
  const present = existing.filter((row) => remove.has(row.message_id));
  if (present.length)
    result.push({
      type: "removeMessages",
      messageIds: present.map((row) => row.message_id)
    });
  const ordered = new Set(write.order);
  const kept = existing.filter((row) => !remove.has(row.message_id));
  const final = [
    ...write.order,
    ...kept
      .map((row) => row.message_id)
      .filter((messageId) => !ordered.has(messageId))
  ];
  const values = new Map(write.put.map((entry) => [entry.id, entry.value]));
  const positions = new Map(kept.map((row) => [row.message_id, row.position]));
  final.forEach((messageId, position) => {
    const value = values.get(messageId);
    if (value) result.push({ type: "putMessage", messageId, position, value });
    else if (!positions.has(messageId))
      throw new ConversationStorageError(
        "message_missing",
        "A synced message was not provided."
      );
    else if (positions.get(messageId) !== position)
      result.push({ type: "moveMessage", messageId, position });
  });
  if (!created && result.length)
    result.push({ type: "setMetadata", value: { updatedAt: write.updatedAt } });
  if (write.archive) result.push({ type: "setDeleted", deleted: true });
  return result;
}

/**
 * Writes the sessions device sync merged. A session changed since its export is left for the next sync, and
 * one with a running reply or pending review is not touched.
 */
export function applySyncSessions(
  storage: SyncStorage,
  key: string,
  writes: readonly DeviceSyncConversationSessionWrite[]
): DeviceSyncConversationApplyResult {
  const results: DeviceSyncConversationApplyResult["results"] = [];
  for (const write of writes) {
    const result = (
      status: "applied" | "changed" | "busy",
      revision: number | null
    ) => results.push({ sessionId: write.sessionId, status, revision });
    let row = sessionRow(storage.sql, key, write.sessionId);
    if (
      write.expectedRevision === null
        ? row !== undefined
        : Number(row?.revision ?? -1) !== write.expectedRevision
    ) {
      result("changed", row ? Number(row.revision) : null);
      continue;
    }
    if (
      storage.sql
        .get(
          "SELECT 1 FROM purged_sessions WHERE scope_key = ? AND session_id = ?"
        )
        .get(key, write.sessionId)
    ) {
      // A permanently deleted conversation is never recreated here.
      result("applied", null);
      continue;
    }
    const existing = row ? messageRows(storage.sql, key, write.sessionId) : [];
    if (existing.some((message) => message.running || message.pending)) {
      result("busy", Number(row!.revision));
      continue;
    }
    try {
      const commit = (operations: ConversationHistoryOperation[]) => {
        const receipt = storage.commit({
          key,
          sessionId: write.sessionId,
          batchId: `device_sync_${randomUUID()}`,
          expectedRevision: Number(row?.revision ?? 0),
          generation: Number(row?.generation ?? 0),
          sequence: Number(row?.sequence ?? 0) + 1,
          operations
        });
        row = {
          revision: receipt.revision,
          generation: receipt.generation,
          sequence: receipt.sequence,
          deleted: 0,
          metadata_ref: null
        };
      };
      // A deleted session accepts only its restoration; changes follow in the next batch.
      if (write.restore && row?.deleted)
        commit([{ type: "setDeleted", deleted: false }]);
      const changes = operations(write, existing, !row);
      if (changes.length) commit(changes);
      result("applied", row ? Number(row.revision) : null);
    } catch (error) {
      if (!(error instanceof ConversationStorageError)) throw error;
      result(error.code === "session_busy" ? "busy" : "changed", null);
    }
  }
  return { results };
}
