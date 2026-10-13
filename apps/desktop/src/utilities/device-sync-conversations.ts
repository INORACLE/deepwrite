import {
  DeviceSyncConversationApplyResultSchema,
  DeviceSyncConversationExportSchema,
  DeviceSyncConversationInventorySchema,
  type CommandResult
} from "@deepwrite/contracts";
import type { RendererStateStore } from "./renderer-state-store";
import { describeStorageFailure } from "./conversation-storage/storage-failure";

type ConversationSyncCommand = Extract<
  Parameters<RendererStateStore["syncConversations"]>[0],
  object
>;

/** Core answers Main's conversation sync requests from the storage worker, the only database writer. */
export async function handleConversationSyncCommand(
  store: Pick<RendererStateStore, "syncConversations">,
  command: { id: string; payload: ConversationSyncCommand }
): Promise<CommandResult> {
  try {
    const raw = await store.syncConversations(command.payload);
    const payload =
      command.payload.operation === "inventory"
        ? DeviceSyncConversationInventorySchema.parse(raw)
        : command.payload.operation === "export"
          ? DeviceSyncConversationExportSchema.parse(raw)
          : DeviceSyncConversationApplyResultSchema.parse(raw);
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    const { message } = describeStorageFailure(error, "operation");
    return {
      status: "rejected",
      requestId: command.id,
      error: { code: "device_sync.conversations_failed", message }
    };
  }
}
