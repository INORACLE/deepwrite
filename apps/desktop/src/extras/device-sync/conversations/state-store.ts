import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  conversationSyncLocalStateSchema,
  stableSyncJson,
  type ConversationSyncLocalState
} from "@deepwrite/contracts";
import { writeSyncJson } from "../atomic-json";

/** Main is the only writer, so reads after the first one are served from memory. */
export class ConversationSyncStateStore {
  private readonly path: string;
  private cached: ConversationSyncLocalState | null | undefined;
  constructor(root: string) {
    this.path = join(root, "device-sync-conversations.json");
  }
  async read(): Promise<ConversationSyncLocalState | null> {
    if (this.cached !== undefined) return this.cached;
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.cached = null;
        return null;
      }
      throw error;
    }
    this.cached = conversationSyncLocalStateSchema.parse(JSON.parse(text));
    return this.cached;
  }
  async write(value: ConversationSyncLocalState): Promise<void> {
    const parsed = conversationSyncLocalStateSchema.parse(value);
    this.cached = undefined;
    await writeSyncJson(this.path, stableSyncJson(parsed));
    this.cached = parsed;
  }
}
