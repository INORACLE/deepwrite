import {
  createEnvelope,
  IPC_EVENT_CHANNEL,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";

interface LeaseWindow {
  isDestroyed(): boolean;
  webContents: { id: number; send(channel: string, value: unknown): void };
}
export interface ConversationSyncLeaseGrant {
  /** Logical conversation keys the window saved and holds until `finish`. */
  released: string[];
  finish(changed: string[]): void;
}
export interface ConversationSyncLease {
  acquire(keys: string[]): Promise<ConversationSyncLeaseGrant>;
}

/**
 * The window keeps open conversations in memory with their storage revisions. Before sync writes a book's
 * conversations, the window saves and holds them; afterwards it reloads the ones that changed. A window that
 * does not answer releases nothing, so its conversations wait for a later sync.
 */
export function createConversationSyncLeaseCoordinator(
  window: () => LeaseWindow | undefined,
  timeoutMs = 15_000
) {
  const pending = new Map<
    string,
    { senderId: number; resolve(released: string[]): void }
  >();
  function handleCommand(
    senderId: number,
    command: CommandEnvelope
  ): CommandResult | undefined {
    if (command.type !== "deviceSync.conversationLeaseResult") return undefined;
    const request = pending.get(command.payload.requestId);
    if (request?.senderId === senderId) {
      pending.delete(command.payload.requestId);
      request.resolve(command.payload.released);
    }
    return { status: "accepted", requestId: command.id, payload: { ok: true } };
  }
  async function acquire(keys: string[]): Promise<ConversationSyncLeaseGrant> {
    const target = window();
    if (!target || target.isDestroyed())
      return { released: [...keys], finish: () => undefined };
    const requestId = createId("conversation_lease");
    const senderId = target.webContents.id;
    const released = await new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve([]);
      }, timeoutMs);
      pending.set(requestId, {
        senderId,
        resolve(value) {
          clearTimeout(timer);
          resolve(value.filter((key) => keys.includes(key)));
        }
      });
      try {
        target.webContents.send(
          IPC_EVENT_CHANNEL,
          createEnvelope(
            "deviceSync.conversationLease",
            { keys },
            { id: requestId, correlationId: requestId }
          )
        );
      } catch {
        pending.get(requestId)?.resolve([]);
        pending.delete(requestId);
      }
    });
    let finished = false;
    return {
      released,
      finish(changed) {
        if (finished) return;
        finished = true;
        if (target.isDestroyed()) return;
        try {
          target.webContents.send(
            IPC_EVENT_CHANNEL,
            createEnvelope(
              "deviceSync.conversationsChanged",
              { requestId, changed },
              { id: createId("conversation_changed"), correlationId: requestId }
            )
          );
        } catch {
          /* A reloaded window reads the stored conversations anyway. */
        }
      }
    };
  }
  return { acquire, handleCommand };
}
