import type {
  SyncConversationStatus,
  SyncDirection,
  SyncMetadata,
  SyncProgress,
  SyncRuntime,
  SyncServiceOptions
} from "@deepwrite/contracts";
import { connectedSyncRemote } from "../engine/connection";
import type { SyncRemote } from "../engine/remote";
import type { ConversationBookPort } from "./book-sync";
import type { ConversationSyncLease } from "./lease";
import {
  conversationSyncState,
  remoteConversationBooks,
  runConversationSync
} from "./run";
import type { ConversationSyncStateStore } from "./state-store";

export interface ConversationSyncHooks {
  store: ConversationSyncStateStore;
  port(key: string): ConversationBookPort & { logicalKey: string };
  lease: ConversationSyncLease;
  busy(): boolean;
}

export async function conversationStatus(
  hooks: ConversationSyncHooks,
  spaceId: string | null
): Promise<SyncConversationStatus> {
  const state = await conversationSyncState(hooks.store, spaceId);
  return {
    enabledKeys: state.enabledKeys,
    remoteBooks: state.remoteBooks,
    remoteDevices: state.remoteDevices,
    localSessions: Object.fromEntries(
      Object.entries(state.books).map(([key, book]) => [
        key,
        Object.values(book.sessions).filter(
          (session) => session.confirmed.native === "live"
        ).length
      ])
    ),
    lastRun: state.lastRun,
    issues: state.issues
  };
}

/** Only works that take part in work sync can sync their conversations. */
export async function configureConversations(
  hooks: ConversationSyncHooks,
  metadata: SyncMetadata,
  keys: string[]
): Promise<void> {
  const spaceId = metadata.config?.spaceId ?? null;
  const excluded = new Set(metadata.config?.excludedKeys ?? []);
  const enabledKeys = [...new Set(keys)]
    .filter(
      (key) =>
        (key.startsWith("book:") || key.startsWith("long-book:")) &&
        !excluded.has(key)
    )
    .sort();
  const state = await conversationSyncState(hooks.store, spaceId);
  // A newly chosen work must be merged with commits already merged for other works.
  await hooks.store.write({ ...state, enabledKeys, merged: {} });
}

/** Refreshes what other devices published, so the scope list can show sizes before downloading. */
export async function refreshConversationRemote(
  hooks: ConversationSyncHooks,
  remote: SyncRemote,
  spaceId: string,
  deviceId: string
): Promise<void> {
  const { loaded } = await remote.conversations().commits(spaceId);
  const others = loaded.filter((entry) => entry.deviceId !== deviceId);
  const state = await conversationSyncState(hooks.store, spaceId);
  await hooks.store.write({
    ...state,
    remoteBooks: remoteConversationBooks(others.map((entry) => entry.commit)),
    remoteDevices: others.length
  });
}

export async function syncConversations(
  hooks: ConversationSyncHooks,
  input: {
    remote: SyncRemote;
    metadata: SyncMetadata;
    direction: SyncDirection;
    works: { key: string; title: string }[];
    runtime: SyncRuntime;
    signal: AbortSignal;
    progress(value: Pick<SyncProgress, "title" | "titleText">): void;
  }
): Promise<void> {
  const config = input.metadata.config;
  if (!config?.spaceId) return;
  const state = await conversationSyncState(hooks.store, config.spaceId);
  if (!state.enabledKeys.length && !state.published) return;
  // Only works that already took part in work sync, so a work never arrives without its conversations' owner.
  const works = input.works.filter(
    (work) =>
      !config.excludedKeys.includes(work.key) &&
      input.metadata.baselines[work.key]?.item
  );
  await runConversationSync({
    remote: input.remote,
    spaceId: config.spaceId,
    deviceId: input.metadata.deviceId,
    deviceName: config.deviceName,
    direction: input.direction,
    store: hooks.store,
    works,
    port: hooks.port,
    lease: hooks.lease,
    busy: hooks.busy,
    runtime: input.runtime,
    signal: input.signal,
    progress: input.progress
  });
}

/** A run that stopped before writing its state still reports why. */
export async function recordConversationFailure(
  hooks: ConversationSyncHooks,
  spaceId: string
): Promise<void> {
  const state = await conversationSyncState(hooks.store, spaceId);
  await hooks.store.write({
    ...state,
    issues: [{ key: "conversations", title: "", code: "conversationsFailed" }]
  });
}

/** Conversations follow works; their failure never fails the work sync that already finished. */
export async function syncConversationsAfterWorks(
  hooks: ConversationSyncHooks,
  input: {
    options: SyncServiceOptions;
    metadata: SyncMetadata;
    direction: SyncDirection;
    works: { key: string; title: string }[];
    signal: AbortSignal;
    state: { progress: SyncProgress };
  }
): Promise<void> {
  const { metadata, signal, state } = input;
  const config = metadata.config;
  if (!metadata.firstSyncConfirmed || !config?.spaceId) return;
  const finished = state.progress;
  try {
    await syncConversations(hooks, {
      remote: await connectedSyncRemote(input.options, config, signal),
      metadata,
      direction: input.direction,
      works: input.works,
      runtime: input.options.runtime,
      signal,
      progress: (title) => {
        state.progress = { ...finished, phase: "transferring", ...title };
      }
    });
  } catch (error) {
    if (signal.aborted) throw error;
    await recordConversationFailure(hooks, config.spaceId);
  } finally {
    if (!signal.aborted) state.progress = finished;
  }
}
