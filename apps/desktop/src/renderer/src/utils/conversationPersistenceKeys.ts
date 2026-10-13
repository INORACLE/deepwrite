import { createScopedTranslator } from "../i18n";
import { conversationHistoryKeyFor } from "@deepwrite/contracts/renderer";

const t = createScopedTranslator("workspace.conversationStore");
export const HISTORY_PREFIX = "conversation-history:";
export const MODEL_SELECTION_PERSISTENCE_KEY =
  "conversation-preferences:model-selection:v1";
export const RUN_PREFERENCES_PERSISTENCE_KEY =
  "conversation-preferences:run-options:v1";
export const LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX =
  "deepwrite:agent-conversations:v1:";
const MAX_PERSISTENCE_KEY_LENGTH = 240;
const HASHED_KEY_SUFFIX = /~[a-f0-9]{16}$/u;

export type ConversationLegacyStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "key" | "length"
>;

export interface ConversationPersistenceAdapterOptions {
  storage?: ConversationLegacyStorage;
  beforeClose?(): Promise<void>;
}

/**
 * Converts an in-memory conversation identity into a contract-safe key.
 * Long filesystem-derived identities retain a readable prefix plus a stable
 * suffix, while ordinary keys remain fully reversible in diagnostics.
 */
export function conversationHistoryPersistenceKey(key: string): string {
  if (!key.trim()) throw new Error(t("conversationKeyCannotBeEmpty"));
  return conversationHistoryKeyFor(key);
}

export function legacyConversationHistoryStorageKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error(t("conversationKeyCannotBeEmpty"));
  return `${LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX}${encodeURIComponent(normalized)}`;
}

function decodePersistenceSuffix(encoded: string): string | undefined {
  const hashed = HASHED_KEY_SUFFIX.exec(encoded)?.[0];
  const reversible = hashed ? encoded.slice(0, -hashed.length) : encoded;
  if (!reversible) return undefined;
  try {
    return decodeURIComponent(reversible);
  } catch {
    return reversible;
  }
}

export function persistenceKeyFromLegacyStorageKey(
  storageKey: string
): string | undefined {
  if (storageKey.startsWith(LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX)) {
    const encoded = storageKey.slice(
      LEGACY_CONVERSATION_HISTORY_STORAGE_PREFIX.length
    );
    const logicalKey = decodePersistenceSuffix(encoded);
    if (!logicalKey?.trim()) return undefined;
    try {
      return conversationHistoryPersistenceKey(logicalKey);
    } catch {
      return undefined;
    }
  }
  if (
    storageKey.startsWith(HISTORY_PREFIX) &&
    storageKey.length <= MAX_PERSISTENCE_KEY_LENGTH
  ) {
    const encoded = storageKey.slice(HISTORY_PREFIX.length);
    if (HASHED_KEY_SUFFIX.test(encoded)) return storageKey;
    const logicalKey = decodePersistenceSuffix(encoded);
    if (!logicalKey?.trim()) return undefined;
    try {
      return conversationHistoryPersistenceKey(logicalKey);
    } catch {
      return storageKey;
    }
  }
  return undefined;
}
