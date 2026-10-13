import {
  emptyConversationSyncState,
  stableSyncJson,
  type ConversationSyncCommit,
  type ConversationSyncIssue,
  type ConversationSyncLocalState,
  type SyncDirection,
  type SyncRuntime
} from "@deepwrite/contracts";
import { syncProgressTitle } from "../../../localization/sync-display-text";
import type { SyncRemote } from "../engine/remote";
import { syncConversationBook, type ConversationBookPort } from "./book-sync";
import type {
  ConversationSyncLease,
  ConversationSyncLeaseGrant
} from "./lease";
import type { ConversationSyncStateStore } from "./state-store";

export interface ConversationSyncRun {
  remote: SyncRemote;
  spaceId: string;
  deviceId: string;
  deviceName: string;
  direction: SyncDirection;
  store: ConversationSyncStateStore;
  /** Works this device holds and syncs, with their titles. */
  works: { key: string; title: string }[];
  port(key: string): ConversationBookPort & { logicalKey: string };
  lease: ConversationSyncLease;
  busy(): boolean;
  runtime: SyncRuntime;
  signal: AbortSignal;
  progress(title: ReturnType<typeof syncProgressTitle>): void;
}

/** The state for the current space; joining another space starts over but keeps the chosen works. */
export async function conversationSyncState(
  store: ConversationSyncStateStore,
  spaceId: string | null
): Promise<ConversationSyncLocalState> {
  const state = await store.read();
  if (state?.spaceId === spaceId) return state;
  return emptyConversationSyncState(spaceId, state?.enabledKeys ?? []);
}

/** Summaries of the conversations other devices published, for the scope list. */
export function remoteConversationBooks(
  commits: ConversationSyncCommit[]
): ConversationSyncLocalState["remoteBooks"] {
  const books: ConversationSyncLocalState["remoteBooks"] = {};
  for (const commit of commits)
    for (const [key, summary] of Object.entries(commit.books)) {
      const known = books[key];
      if (!known || summary.bytes > known.bytes)
        books[key] = { sessions: summary.sessions, bytes: summary.bytes };
    }
  return books;
}

export async function runConversationSync(
  input: ConversationSyncRun
): Promise<ConversationSyncLocalState> {
  let state = await conversationSyncState(input.store, input.spaceId);
  const remote = input.remote.conversations();
  const { loaded, unreadable } = await remote.commits(input.spaceId);
  const own =
    loaded.find((entry) => entry.deviceId === input.deviceId)?.commit ??
    state.published?.commit ??
    null;
  const others = loaded.filter((entry) => entry.deviceId !== input.deviceId);
  const issues: ConversationSyncIssue[] = unreadable.map((deviceId) => ({
    key: `device:${deviceId}`,
    title: deviceId,
    code: "conversationsUnreadable"
  }));
  const titles = new Map(input.works.map((work) => [work.key, work.title]));
  const books: ConversationSyncCommit["books"] = {};
  const sessions = { ...state.books };
  let uploaded = 0;
  let downloaded = 0;
  for (const key of state.enabledKeys) {
    if (input.signal.aborted) throw new Error("同步已取消。");
    const title = titles.get(key);
    if (title === undefined) {
      if (others.some((entry) => entry.commit.books[key]))
        issues.push({ key, title: key, code: "conversationsWorkMissing" });
      continue;
    }
    input.progress(syncProgressTitle("syncingConversations", { title }));
    const port = input.port(key);
    const held: { grant: ConversationSyncLeaseGrant | null } = { grant: null };
    let changed = false;
    try {
      const result = await syncConversationBook({
        key,
        spaceId: input.spaceId,
        remote,
        port,
        runtime: input.runtime,
        direction: input.direction,
        own: own?.books[key],
        others: others.flatMap((entry) =>
          entry.commit.books[key] && state.merged[entry.deviceId] !== entry.hash
            ? [
                {
                  deviceName: entry.commit.deviceName,
                  summary: entry.commit.books[key]
                }
              ]
            : []
        ),
        local: state.books[key]?.sessions ?? {},
        lease: async () => {
          if (input.busy()) return false;
          held.grant = await input.lease.acquire([port.logicalKey]);
          return held.grant.released.includes(port.logicalKey);
        },
        signal: input.signal
      });
      changed = result.downloaded > 0;
      sessions[key] = { sessions: result.sessions };
      if (result.summary) books[key] = result.summary;
      uploaded += result.uploaded;
      downloaded += result.downloaded;
      if (result.issue) issues.push({ key, title, code: result.issue });
    } catch (error) {
      if (input.signal.aborted) throw error;
      if (own?.books[key]) books[key] = own.books[key];
      issues.push({ key, title, code: "conversationsFailed" });
    } finally {
      held.grant?.finish(changed ? [port.logicalKey] : []);
    }
  }

  const complete = !issues.length;
  // Receipts name the content received, not the commit, so they settle once devices hold the same state.
  const receipts = complete
    ? Object.fromEntries(
        others.map((entry) => [
          entry.deviceId,
          input.runtime.hash(stableSyncJson(entry.commit.books))
        ])
      )
    : (own?.receipts ?? {});
  let published = state.published;
  if (Object.keys(books).length || own) {
    const unchanged =
      own &&
      stableSyncJson({ books, receipts, name: input.deviceName }) ===
        stableSyncJson({
          books: own.books,
          receipts: own.receipts,
          name: own.deviceName
        });
    if (!unchanged) {
      const commit: ConversationSyncCommit = {
        schemaVersion: 1,
        kind: "deepwrite.conversation-commit",
        spaceId: input.spaceId,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        sequence: (own?.sequence ?? 0) + 1,
        createdAt: input.runtime.now(),
        books,
        receipts
      };
      published = { hash: await remote.publish(commit), commit };
    } else if (own && !published)
      published = {
        hash: input.runtime.hash(stableSyncJson(own)),
        commit: own
      };
  }
  state = {
    ...state,
    published,
    books: sessions,
    merged: complete
      ? Object.fromEntries(others.map((entry) => [entry.deviceId, entry.hash]))
      : state.merged,
    remoteBooks: remoteConversationBooks(others.map((entry) => entry.commit)),
    remoteDevices: others.length,
    lastRun: { at: input.runtime.now(), uploaded, downloaded },
    issues
  };
  await input.store.write(state);
  return state;
}
