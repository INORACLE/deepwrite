import {
  conversationSyncBookSchema,
  conversationSyncSessionSchema,
  deriveConversationSession,
  mergeConversationSessions,
  planConversationSession,
  stableSyncJson,
  syncEqual,
  type ConversationSyncBook,
  type ConversationSyncLocalSession,
  type ConversationSyncSession,
  type SyncDirection,
  type SyncFileRef,
  type SyncRuntime
} from "@deepwrite/contracts";
import type { ConversationRemote } from "./remote";
import {
  applyConversationPlans,
  type PlannedConversationSession
} from "./book-apply";
import {
  confirmedFrom,
  nativeSession,
  type BookSummary,
  type ConversationBookPort,
  type ConversationBookResult
} from "./book-port";
export type {
  ConversationBookPort,
  ConversationSessionWrite,
  LocalConversationSession
} from "./book-port";

/**
 * Merges one work's conversations with what other devices published, applies the result locally and returns
 * what this device publishes next. A session that cannot be applied publishes this device's own view instead,
 * so nothing is reported as removed or deleted that this device still holds.
 */
export async function syncConversationBook(input: {
  key: string;
  spaceId: string;
  remote: ConversationRemote;
  port: ConversationBookPort;
  runtime: SyncRuntime;
  direction: SyncDirection;
  own: BookSummary | undefined;
  others: { deviceName: string; summary: BookSummary }[];
  local: Record<string, ConversationSyncLocalSession>;
  lease(): Promise<boolean>;
  signal: AbortSignal;
}): Promise<ConversationBookResult> {
  const { spaceId, remote, port, runtime, own, local } = input;
  const now = runtime.now();
  const inventory = await port.inventory();
  const markers = new Map(inventory.map((entry) => [entry.id, entry.marker]));
  const changed = new Set<string>();
  for (const entry of inventory)
    if (local[entry.id]?.marker !== entry.marker) changed.add(entry.id);
  for (const [id, entry] of Object.entries(local))
    if (!markers.has(id) && entry.confirmed.native !== "absent")
      changed.add(id);
  const theirs = new Map<string, { device: string; ref: SyncFileRef }[]>();
  for (const other of input.others) {
    // Equal to what this device published only matters while this device still knows what it holds.
    if (Object.keys(local).length && other.summary.ref.hash === own?.ref.hash)
      continue;
    const book = await remote.read(
      spaceId,
      other.summary.ref,
      conversationSyncBookSchema
    );
    for (const [id, summary] of Object.entries(book.sessions)) {
      if (summary.ref.hash === local[id]?.ref?.hash) continue;
      changed.add(id);
      theirs.set(id, [
        ...(theirs.get(id) ?? []),
        { device: other.deviceName, ref: summary.ref }
      ]);
    }
  }
  const result: ConversationBookResult = {
    summary: own ?? null,
    sessions: { ...local },
    uploaded: 0,
    downloaded: 0,
    issue: null
  };
  if (!changed.size) return result;
  const ownBook: ConversationSyncBook | null = own
    ? await remote.read(spaceId, own.ref, conversationSyncBookSchema)
    : null;

  const read = new Map(
    (await port.read([...changed].filter((id) => markers.has(id)))).map(
      (session) => [session.id, session]
    )
  );
  const prevs = new Map<string, ConversationSyncSession>();
  const remotes = new Map<string, ConversationSyncSession[]>();
  const known = new Map<string, SyncFileRef>();
  const devices = new Map<string, string>();
  for (const id of changed) {
    if (input.signal.aborted) throw new Error("同步已取消。");
    const ref = local[id]?.ref;
    if (ref) {
      const prev = await remote.read(
        spaceId,
        ref,
        conversationSyncSessionSchema
      );
      prevs.set(id, prev);
      for (const entry of prev.messages)
        known.set(entry.record.hash, entry.record);
    }
    for (const source of theirs.get(id) ?? []) {
      const manifest = await remote.read(
        spaceId,
        source.ref,
        conversationSyncSessionSchema
      );
      remotes.set(id, [...(remotes.get(id) ?? []), manifest]);
      for (const entry of manifest.messages) {
        known.set(entry.record.hash, entry.record);
        devices.set(entry.record.hash, source.device);
      }
    }
  }
  const contents = new Map<string, string>();
  for (const session of read.values())
    for (const message of session.messages) {
      if (!message.record) continue;
      if (message.foreignHash && known.has(message.foreignHash)) continue;
      const content = stableSyncJson(message.record);
      contents.set(runtime.hash(content), content);
    }
  const refs = await remote.upload(spaceId, contents.values(), known);

  const publish = new Map<string, ConversationSyncSession>();
  const planned: PlannedConversationSession[] = [];
  for (const id of changed) {
    const session = read.get(id);
    const native = session ? nativeSession(session, refs, runtime.hash) : null;
    const prev = prevs.get(id) ?? null;
    const derived = deriveConversationSession({
      prev,
      confirmed: local[id]?.confirmed ?? null,
      native,
      now
    });
    const others = remotes.get(id) ?? [];
    // A local session nobody else has seen is published once it has a message.
    if (!prev && !others.length && !derived?.messages.length) continue;
    if (derived && (!prev || !syncEqual(derived, prev))) result.uploaded++;
    const confirmed = confirmedFrom(native);
    const marker = markers.get(id) ?? "";
    if (derived) {
      publish.set(id, derived);
      result.sessions[id] = { ref: local[id]?.ref ?? null, marker, confirmed };
    }
    if (input.direction === "upload") continue;
    const merged = mergeConversationSessions([
      ...(derived ? [derived] : []),
      ...others
    ]);
    const plan = planConversationSession(
      merged,
      native
        ? {
            deleted: native.deleted,
            messages: native.messages.map((entry) => ({
              id: entry.id,
              hash: entry.ref.hash
            })),
            pending: native.pending
          }
        : null
    );
    if (!plan.unchanged) planned.push({ id, plan, merged, native });
    else {
      publish.set(id, merged);
      result.sessions[id] = { ref: local[id]?.ref ?? null, marker, confirmed };
    }
  }

  await applyConversationPlans({
    spaceId,
    remote,
    port,
    runtime,
    planned,
    markers,
    contents,
    devices,
    lease: input.lease,
    publish,
    result
  });

  const manifests = [...publish.entries()].map(([id, manifest]) => ({
    id,
    manifest,
    text: stableSyncJson(conversationSyncSessionSchema.parse(manifest))
  }));
  const uploaded = await remote.upload(
    spaceId,
    manifests.map(({ text }) => text)
  );
  const sessions = { ...ownBook?.sessions };
  for (const { id, manifest, text } of manifests) {
    const ref = uploaded.get(runtime.hash(text))!;
    sessions[id] = {
      ref,
      messages: manifest.messages.length,
      bytes: manifest.messages.reduce((total, entry) => total + entry.bytes, 0),
      deleted: manifest.state.deleted
    };
    result.sessions[id] = { ...result.sessions[id]!, ref };
  }
  const book = conversationSyncBookSchema.parse({
    schemaVersion: 1,
    kind: "deepwrite.conversation-book",
    key: input.key,
    sessions
  });
  const bookText = stableSyncJson(book);
  const live = Object.values(sessions).filter((entry) => !entry.deleted);
  result.summary = {
    ref: (await remote.upload(spaceId, [bookText])).get(
      runtime.hash(bookText)
    )!,
    sessions: live.length,
    bytes: live.reduce((total, entry) => total + entry.bytes, 0)
  };
  return result;
}
