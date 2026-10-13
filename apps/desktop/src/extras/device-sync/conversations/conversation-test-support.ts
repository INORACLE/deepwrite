import type {
  DeviceSyncConversationRequest,
  SyncServiceOptions
} from "@deepwrite/contracts";
import { DeviceSyncService } from "../engine/service";
import { desktopConversationPort } from "./desktop-port";
import type { ConversationSyncLease } from "./lease";
import type { ConversationSyncHooks } from "./service";
import { ConversationSyncStateStore } from "./state-store";

type Value = Record<string, unknown>;
export interface FakeSession {
  revision: number;
  deleted: boolean;
  metadata: Value;
  messages: Value[];
}

/** Core's conversation storage as device sync sees it: revisions, archives and ordered messages. */
export class FakeConversationCore {
  readonly scopes = new Map<string, Map<string, FakeSession>>();
  scope(key: string): Map<string, FakeSession> {
    let scope = this.scopes.get(key);
    if (!scope) {
      scope = new Map();
      this.scopes.set(key, scope);
    }
    return scope;
  }
  /** A local edit, like the window saving a conversation. */
  write(
    key: string,
    sessionId: string,
    change: (session: FakeSession) => void
  ) {
    const scope = this.scope(key);
    const session = scope.get(sessionId) ?? {
      revision: 0,
      deleted: false,
      metadata: {
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z"
      },
      messages: []
    };
    change(session);
    session.revision++;
    scope.set(sessionId, session);
  }
  async request(payload: DeviceSyncConversationRequest): Promise<unknown> {
    if (payload.operation === "inventory")
      return {
        scopes: Object.fromEntries(
          payload.keys.map((key) => [
            key,
            {
              sessions: [...this.scope(key)].map(([sessionId, session]) => ({
                sessionId,
                revision: session.revision,
                deleted: session.deleted,
                messageCount: session.messages.length
              }))
            }
          ])
        )
      };
    const scope = this.scope(payload.key);
    if (payload.operation === "export")
      return {
        sessions: payload.sessionIds.flatMap((sessionId) => {
          const session = scope.get(sessionId);
          return session
            ? [
                {
                  sessionId,
                  revision: session.revision,
                  deleted: session.deleted,
                  metadata: structuredClone(session.metadata),
                  messages: session.messages.map((value) => ({
                    id: String(value.id),
                    value: structuredClone(value)
                  }))
                }
              ]
            : [];
        })
      };
    return {
      results: payload.sessions.map((write) => {
        const session = scope.get(write.sessionId);
        if (
          (write.expectedRevision === null) !== !session ||
          (session && session.revision !== write.expectedRevision)
        )
          return {
            sessionId: write.sessionId,
            status: "changed",
            revision: session?.revision ?? null
          };
        const next: FakeSession = session ?? {
          revision: 0,
          deleted: false,
          metadata: { createdAt: write.createdAt, updatedAt: write.updatedAt },
          messages: []
        };
        if (write.restore) next.deleted = false;
        const removed = new Set(write.remove);
        const values = new Map(
          write.put.map((entry) => [entry.id, entry.value])
        );
        const kept = new Map(
          next.messages
            .filter((value) => !removed.has(String(value.id)))
            .map((value) => [String(value.id), value])
        );
        next.messages = [
          ...write.order,
          ...[...kept.keys()].filter((id) => !write.order.includes(id))
        ].map((id) => structuredClone(values.get(id) ?? kept.get(id)!));
        if (write.archive) next.deleted = true;
        next.revision++;
        scope.set(write.sessionId, next);
        return {
          sessionId: write.sessionId,
          status: "applied",
          revision: next.revision
        };
      })
    };
  }
}

export function message(
  id: string,
  content: string,
  createdAt: string,
  role: "user" | "assistant" = "user"
): Value {
  return { id, role, content, createdAt, status: "completed" };
}

/** A desktop sync service with conversation sync over the fake Core and a test lease. */
export function conversationService(
  options: SyncServiceOptions,
  root: string,
  core = new FakeConversationCore()
) {
  const lease: ConversationSyncLease & {
    released: boolean;
    changed: string[][];
  } = {
    released: true,
    changed: [],
    async acquire(keys) {
      return {
        released: lease.released ? keys : [],
        finish: (changed) => {
          lease.changed.push(changed);
        }
      };
    }
  };
  const hooks: ConversationSyncHooks = {
    store: new ConversationSyncStateStore(root),
    port: (key) =>
      desktopConversationPort(
        key,
        (payload) => core.request(payload),
        options.runtime.now
      ),
    lease,
    busy: () => false
  };
  return { service: new DeviceSyncService(options, hooks), core, lease };
}
