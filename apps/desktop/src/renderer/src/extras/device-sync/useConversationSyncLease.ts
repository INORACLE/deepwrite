import { onBeforeUnmount, onMounted } from "vue";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { conversationHistoryPersistenceKey } from "../../utils/conversationPersistenceKeys";
import { invalidateConversationHistoryCursors } from "../../utils/conversationHistoryWriter";

interface LeaseStore {
  controllerForKey(key: string): AgentConversationController | undefined;
  scopeForKey(key: string): string | undefined;
  removeController(key: string): unknown;
  scheduleControllerPersistence?(
    key: string,
    controller: AgentConversationController
  ): void;
  flushPersistence(key: string): Promise<void>;
  invalidatePersistenceCache(key: string): void;
}
interface LeaseRegistry {
  conversationForKey(key: string, scope: string): AgentConversationController;
  drain(): Promise<void>;
}
export interface ConversationSyncLeaseApi {
  onConversationLease?(
    handler: (request: {
      requestId: string;
      keys: string[];
    }) => Promise<string[]>
  ): () => void;
  onConversationsChanged?(
    handler: (result: { requestId: string; changed: string[] }) => void
  ): () => void;
}

/**
 * Device sync writes a work's conversations in Core. Open conversations are saved and held first, and the
 * changed ones are rebuilt from storage afterwards, so the window never saves over what sync wrote.
 */
export function createConversationSyncLease(options: {
  store: LeaseStore;
  registry: LeaseRegistry;
}) {
  const held = new Map<string, string[]>();
  async function lease(request: { requestId: string; keys: string[] }) {
    const released: string[] = [];
    for (const key of request.keys) {
      const controller = options.store.controllerForKey(key);
      if (controller?.isBusy.value || controller?.hasPendingEditReview.value)
        continue;
      const persistenceKey = conversationHistoryPersistenceKey(key);
      try {
        if (controller) {
          options.store.scheduleControllerPersistence?.(
            persistenceKey,
            controller
          );
          controller.holdPersistenceEmits();
        }
        await options.store.flushPersistence(persistenceKey);
        released.push(key);
      } catch {
        controller?.releasePersistenceEmits();
      }
    }
    held.set(request.requestId, released);
    return released;
  }
  async function changed(result: { requestId: string; changed: string[] }) {
    const keys = held.get(result.requestId) ?? [];
    held.delete(result.requestId);
    for (const key of keys) {
      const controller = options.store.controllerForKey(key);
      if (!result.changed.includes(key)) {
        controller?.releasePersistenceEmits();
        continue;
      }
      const persistenceKey = conversationHistoryPersistenceKey(key);
      const scope = options.store.scopeForKey(key);
      const typed = controller
        ? {
            sessionId: controller.sessionId.value,
            draft: controller.draft.value
          }
        : null;
      if (controller) options.store.removeController(key);
      options.store.invalidatePersistenceCache(persistenceKey);
      invalidateConversationHistoryCursors(persistenceKey);
      if (!controller || !scope) continue;
      // Text typed while sync held the conversation is not lost by the rebuild.
      const next = options.registry.conversationForKey(key, scope);
      await options.registry.drain();
      if (
        typed?.draft &&
        !next.draft.value &&
        next.sessionId.value === typed.sessionId
      )
        next.draft.value = typed.draft;
    }
  }
  return { lease, changed };
}

export function useConversationSyncLease(options: {
  api(): ConversationSyncLeaseApi | undefined;
  store: LeaseStore;
  registry: LeaseRegistry;
}) {
  const handler = createConversationSyncLease(options);
  const stops: (() => void)[] = [];
  onMounted(() => {
    const api = options.api();
    if (api?.onConversationLease)
      stops.push(api.onConversationLease(handler.lease));
    if (api?.onConversationsChanged)
      stops.push(
        api.onConversationsChanged((result) => void handler.changed(result))
      );
  });
  onBeforeUnmount(() => {
    for (const stop of stops.splice(0)) stop();
  });
}
