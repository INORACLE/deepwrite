import {
  stableSyncJson,
  type ConversationConfirmed,
  type ConversationNativeSession,
  type ConversationNativeStatus,
  type ConversationSyncLocalSession,
  type ConversationSyncMessage,
  type ConversationSyncSession,
  type SyncFileRef
} from "@deepwrite/contracts";

export type BookSummary = { ref: SyncFileRef; sessions: number; bytes: number };
export interface LocalConversationSession {
  id: string;
  marker: string;
  createdAt: string;
  deleted: boolean;
  /** Local order; a null record is a message that cannot be exported yet. */
  messages: {
    id: string;
    createdAt: string;
    record: ConversationSyncMessage | null;
    /** Record hash of a message received from another device. */
    foreignHash?: string | undefined;
  }[];
}
export interface ConversationSessionWrite {
  id: string;
  /** Marker read with the session; null when it must not exist yet. */
  expectedMarker: string | null;
  createdAt: string;
  updatedAt: string;
  restore: boolean;
  archive: boolean;
  remove: string[];
  put: { record: ConversationSyncMessage; hash: string; device: string }[];
  order: string[];
}
/** One work's conversations on this device. */
export interface ConversationBookPort {
  /** How this device stores a session another device deleted. */
  readonly archivedStatus: ConversationNativeStatus;
  inventory(): Promise<{ id: string; marker: string }[]>;
  read(ids: string[]): Promise<LocalConversationSession[]>;
  apply(writes: ConversationSessionWrite[]): Promise<
    {
      id: string;
      status: "applied" | "changed" | "busy";
      marker: string | null;
    }[]
  >;
}
export interface ConversationBookResult {
  summary: BookSummary | null;
  sessions: Record<string, ConversationSyncLocalSession>;
  uploaded: number;
  downloaded: number;
  issue: "conversationsBusy" | "conversationsChanged" | null;
}

export function nativeSession(
  session: LocalConversationSession,
  refs: ReadonlyMap<string, SyncFileRef>,
  hashOf: (content: string) => string
): ConversationNativeSession {
  const messages: ConversationNativeSession["messages"] = [];
  const pending: string[] = [];
  for (const message of session.messages) {
    if (!message.record) {
      pending.push(message.id);
      continue;
    }
    const content = stableSyncJson(message.record);
    const foreign = message.foreignHash
      ? refs.get(message.foreignHash)
      : undefined;
    const ref = foreign ?? refs.get(hashOf(content));
    if (!ref) throw new Error("缺少对话内容上传记录。");
    messages.push({
      id: message.id,
      createdAt: message.createdAt,
      ref,
      bytes: content.length,
      foreign: Boolean(foreign)
    });
  }
  return {
    id: session.id,
    createdAt: session.createdAt,
    deleted: session.deleted,
    messages,
    pending
  };
}
export function confirmedFrom(
  session: ConversationNativeSession | null
): ConversationConfirmed {
  return session
    ? {
        native: session.deleted ? "archived" : "live",
        ids: session.messages.map((message) => message.id)
      }
    : { native: "absent", ids: [] };
}
export function latestTime(session: ConversationSyncSession): string {
  return session.messages.reduce(
    (latest, entry) =>
      Date.parse(entry.createdAt) > Date.parse(latest)
        ? entry.createdAt
        : latest,
    session.createdAt
  );
}
