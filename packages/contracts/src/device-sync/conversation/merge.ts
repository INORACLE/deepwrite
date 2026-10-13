import type {
  ConversationSyncEntry,
  ConversationSyncRef,
  ConversationSyncSession,
  ConversationSyncState
} from "./schemas";

/** How a session exists on this device: desktop archives deleted sessions, the phone removes them. */
export type ConversationNativeStatus = "live" | "archived" | "absent";
/** What this device held after its last successful conversation sync. */
export interface ConversationConfirmed {
  native: ConversationNativeStatus;
  ids: string[];
}
export interface ConversationNativeMessage {
  id: string;
  createdAt: string;
  ref: ConversationSyncRef;
  bytes: number;
  /** Received from another device; only that device changes it. */
  foreign: boolean;
}
export interface ConversationNativeSession {
  id: string;
  createdAt: string;
  deleted: boolean;
  /** Finished messages in local order. */
  messages: ConversationNativeMessage[];
  /** Unfinished messages: never exported and never treated as removed. */
  pending: string[];
}

function compareTime(a: string, b: string): number {
  const delta = Date.parse(a) - Date.parse(b);
  if (delta) return delta;
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The newest change wins; on a tie a deletion wins, so a session is not revived by accident. */
export function pickConversationState(
  a: ConversationSyncState,
  b: ConversationSyncState
): ConversationSyncState {
  const order = compareTime(a.at, b.at);
  if (order) return order > 0 ? a : b;
  return a.deleted || !b.deleted ? a : b;
}
function newerEntry(
  a: ConversationSyncEntry,
  b: ConversationSyncEntry
): ConversationSyncEntry {
  const order = compareTime(a.at, b.at);
  if (order) return order > 0 ? a : b;
  return a.record.hash >= b.record.hash ? a : b;
}

/**
 * Orders messages by the message each one followed, so device clocks do not reorder a conversation. When two
 * devices continued the same conversation, the two continuations follow one another, earliest first.
 */
export function orderConversationEntries(
  entries: readonly ConversationSyncEntry[]
): ConversationSyncEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const children = new Map<string | null, ConversationSyncEntry[]>();
  for (const entry of entries) {
    const parent =
      entry.parent !== null &&
      entry.parent !== entry.id &&
      byId.has(entry.parent)
        ? entry.parent
        : null;
    const list = children.get(parent);
    if (list) list.push(entry);
    else children.set(parent, [entry]);
  }
  const compare = (a: ConversationSyncEntry, b: ConversationSyncEntry) =>
    compareTime(a.createdAt, b.createdAt) || compareId(a.id, b.id);
  for (const list of children.values()) list.sort(compare);
  const result: ConversationSyncEntry[] = [];
  const visited = new Set<string>();
  const stack = [...(children.get(null) ?? [])].reverse();
  while (stack.length) {
    const entry = stack.pop()!;
    if (visited.has(entry.id)) continue;
    visited.add(entry.id);
    result.push(entry);
    const next = children.get(entry.id) ?? [];
    for (let index = next.length - 1; index >= 0; index--)
      stack.push(next[index]!);
  }
  // Entries inside a parent cycle are unreachable from the roots.
  const rest = entries.filter((entry) => !visited.has(entry.id)).sort(compare);
  return [...result, ...rest];
}

/** Union of every device's messages minus explicit removals; it never conflicts. */
export function mergeConversationSessions(
  sessions: readonly ConversationSyncSession[]
): ConversationSyncSession {
  const first = sessions[0];
  if (!first) throw new Error("没有可合并的对话。");
  let state = first.state;
  let createdAt = first.createdAt;
  const removed = new Map<string, ConversationSyncSession["removed"][number]>();
  for (const session of sessions) {
    if (session.id !== first.id) throw new Error("对话身份不一致。");
    state = pickConversationState(state, session.state);
    if (compareTime(session.createdAt, createdAt) < 0)
      createdAt = session.createdAt;
    for (const entry of session.removed) {
      const known = removed.get(entry.id);
      if (!known || compareTime(entry.at, known.at) > 0)
        removed.set(entry.id, entry);
    }
  }
  const entries = new Map<string, ConversationSyncEntry>();
  for (const session of sessions)
    for (const entry of session.messages) {
      if (removed.has(entry.id)) continue;
      const known = entries.get(entry.id);
      entries.set(entry.id, known ? newerEntry(known, entry) : entry);
    }
  return {
    schemaVersion: 1,
    kind: "deepwrite.conversation-session",
    id: first.id,
    createdAt,
    state,
    messages: orderConversationEntries([...entries.values()]),
    removed: [...removed.values()].sort((a, b) => compareId(a.id, b.id))
  };
}

/**
 * This device's view of a session: what it last published plus what changed locally since its last sync.
 * Changes are judged against `confirmed`, never against the published manifest, so a merge that could not be
 * applied here is never mistaken for a local edit or deletion.
 */
export function deriveConversationSession(input: {
  prev: ConversationSyncSession | null;
  confirmed: ConversationConfirmed | null;
  native: ConversationNativeSession | null;
  now: string;
}): ConversationSyncSession | null {
  const { prev, confirmed, native, now } = input;
  if (!native) {
    if (!prev) return null;
    const held =
      confirmed?.native === "live" || confirmed?.native === "archived";
    return held && !prev.state.deleted
      ? { ...prev, state: { deleted: true, at: now } }
      : prev;
  }
  const entries = new Map(prev?.messages.map((entry) => [entry.id, entry]));
  const removed = new Map(prev?.removed.map((entry) => [entry.id, entry]));
  const present = new Set([
    ...native.messages.map((entry) => entry.id),
    ...native.pending
  ]);
  if (confirmed?.native === "live" && !native.deleted)
    for (const id of confirmed.ids) {
      if (present.has(id) || removed.has(id)) continue;
      entries.delete(id);
      removed.set(id, { id, at: now });
    }
  let previous: string | null = null;
  for (const message of native.messages) {
    const known = entries.get(message.id);
    if (
      !removed.has(message.id) &&
      (!known || (known.record.hash !== message.ref.hash && !message.foreign))
    )
      entries.set(message.id, {
        id: message.id,
        parent: known ? known.parent : previous,
        createdAt: message.createdAt,
        record: message.ref,
        bytes: message.bytes,
        at: now
      });
    previous = message.id;
  }
  const status: ConversationNativeStatus = native.deleted ? "archived" : "live";
  const state: ConversationSyncState = !prev
    ? { deleted: native.deleted, at: native.deleted ? now : native.createdAt }
    : confirmed?.native === status || prev.state.deleted === native.deleted
      ? prev.state
      : { deleted: native.deleted, at: now };
  return {
    schemaVersion: 1,
    kind: "deepwrite.conversation-session",
    id: native.id,
    createdAt: prev?.createdAt ?? native.createdAt,
    state,
    messages: orderConversationEntries([...entries.values()]),
    removed: [...removed.values()].sort((a, b) => compareId(a.id, b.id))
  };
}

export interface ConversationSessionPlan {
  /** Nothing local needs to change. */
  unchanged: boolean;
  create: boolean;
  restore: boolean;
  /** Desktop archives; the phone removes the session. */
  archive: boolean;
  /** Messages to write, in the final order of `order`. */
  put: ConversationSyncEntry[];
  remove: string[];
  /** Final order of every kept message of a live session. */
  order: string[];
}

/** Local changes that make this device hold the merged session. */
export function planConversationSession(
  merged: ConversationSyncSession,
  native: {
    deleted: boolean;
    messages: { id: string; hash: string }[];
    pending: string[];
  } | null
): ConversationSessionPlan {
  const none: ConversationSessionPlan = {
    unchanged: true,
    create: false,
    restore: false,
    archive: false,
    put: [],
    remove: [],
    order: []
  };
  if (merged.state.deleted)
    return native && !native.deleted
      ? { ...none, unchanged: false, archive: true }
      : none;
  const order = merged.messages.map((entry) => entry.id);
  if (!native)
    return {
      ...none,
      unchanged: false,
      create: true,
      put: merged.messages,
      order
    };
  const removedIds = new Set(merged.removed.map((entry) => entry.id));
  const local = new Map(native.messages.map((entry) => [entry.id, entry.hash]));
  const pending = new Set(native.pending);
  const remove = native.messages
    .filter((entry) => removedIds.has(entry.id))
    .map((entry) => entry.id);
  const put = merged.messages.filter(
    (entry) =>
      !pending.has(entry.id) && local.get(entry.id) !== entry.record.hash
  );
  const kept = native.messages
    .map((entry) => entry.id)
    .filter((value) => !removedIds.has(value));
  const reordered =
    kept.length !== order.length ||
    kept.some((value, index) => value !== order[index]);
  const restore = native.deleted;
  return {
    unchanged: !restore && !remove.length && !put.length && !reordered,
    create: false,
    restore,
    archive: false,
    put,
    remove,
    order
  };
}
