import {
  conversationSyncCommitSchema,
  stableSyncJson,
  syncHeadSchema,
  syncIdSchema,
  type ConversationSyncCommit,
  type SyncFileRef,
  type SyncRuntime,
  type SyncTransport
} from "@deepwrite/contracts";
import type { SyncRemote } from "../engine/remote";

export interface LoadedConversationCommit {
  deviceId: string;
  hash: string;
  commit: ConversationSyncCommit;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function commitPath(root: string, sequence: number, hash: string): string {
  const group = String(Math.floor((sequence - 1) / 256)).padStart(10, "0");
  return `${root}/commits/${group}/${String(sequence).padStart(12, "0")}-${hash}.json`;
}

/**
 * Conversation commits live beside each device's work commits, under `devices/<id>/conversations/`. Versions
 * without conversation sync never read that directory, so they keep syncing works unchanged.
 */
export class ConversationRemote {
  constructor(
    private readonly transport: SyncTransport,
    private readonly runtime: SyncRuntime,
    private readonly contents: SyncRemote,
    private readonly signal?: AbortSignal
  ) {}

  async commits(spaceId: string): Promise<{
    loaded: LoadedConversationCommit[];
    unreadable: string[];
  }> {
    const root = `spaces/${syncIdSchema.parse(spaceId)}/devices`;
    const loaded: LoadedConversationCommit[] = [];
    const unreadable: string[] = [];
    for (const deviceId of await this.transport.list(root, this.signal)) {
      if (!syncIdSchema.safeParse(deviceId).success) continue;
      const directory = `${root}/${deviceId}/conversations`;
      const head = await this.transport.get(
        `${directory}/head.json`,
        this.signal
      );
      if (head === null) continue;
      const ref = syncHeadSchema.safeParse(parseJson(head));
      const text = ref.success
        ? await this.transport.get(
            commitPath(directory, ref.data.sequence, ref.data.hash),
            this.signal
          )
        : null;
      const commit =
        ref.success && text && this.runtime.hash(text) === ref.data.hash
          ? conversationSyncCommitSchema.safeParse(parseJson(text))
          : null;
      if (
        !ref.success ||
        !commit?.success ||
        commit.data.spaceId !== spaceId ||
        commit.data.deviceId !== deviceId ||
        commit.data.sequence !== ref.data.sequence
      ) {
        unreadable.push(deviceId);
        continue;
      }
      loaded.push({ deviceId, hash: ref.data.hash, commit: commit.data });
    }
    return { loaded, unreadable };
  }

  async read<T>(
    spaceId: string,
    ref: SyncFileRef,
    schema: { parse(value: unknown): T }
  ): Promise<T> {
    return schema.parse(
      JSON.parse(await this.contents.readContent(spaceId, ref))
    );
  }
  readText(spaceId: string, ref: SyncFileRef): Promise<string> {
    return this.contents.readContent(spaceId, ref);
  }
  upload(
    spaceId: string,
    contents: Iterable<string>,
    known?: ReadonlyMap<string, SyncFileRef>
  ): Promise<Map<string, SyncFileRef>> {
    return this.contents.uploadContents(spaceId, contents, known);
  }

  async publish(commit: ConversationSyncCommit): Promise<string> {
    const text = stableSyncJson(conversationSyncCommitSchema.parse(commit));
    const hash = this.runtime.hash(text);
    const root = `spaces/${commit.spaceId}/devices/${commit.deviceId}/conversations`;
    const path = commitPath(root, commit.sequence, hash);
    await this.transport.mkdir(
      path.slice(0, path.lastIndexOf("/")),
      this.signal
    );
    await this.transport.put(path, text, this.signal);
    if ((await this.transport.get(path, this.signal)) !== text)
      throw new Error("同步提交读回校验失败。");
    await this.transport.put(
      `${root}/head.json`,
      stableSyncJson({ schemaVersion: 1, hash, sequence: commit.sequence }),
      this.signal
    );
    return hash;
  }
}
