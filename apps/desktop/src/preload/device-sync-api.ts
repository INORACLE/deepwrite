import { ipcRenderer } from "electron";
import {
  createEnvelope,
  DeviceSyncConversationLeaseEventEnvelopeSchema,
  DeviceSyncConversationsChangedEventEnvelopeSchema,
  IPC_EVENT_CHANNEL,
  DEVICE_SYNC_IPC_CHANNEL,
  DeviceSyncRequestEnvelopeSchema,
  syncRequestSchema,
  DeviceSyncIpcResultSchema,
  syncErrorMessage,
  type SyncRequest,
  type SyncResponse
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export const deviceSync = {
  async request(request: SyncRequest): Promise<SyncResponse> {
    try {
      const requestValue = syncRequestSchema.safeParse(request);
      if (!requestValue.success)
        throw new Error("请填写有效的 HTTPS 地址、账号和同步目录。");
      const id = browserId("cmd_device_sync");
      const envelope = DeviceSyncRequestEnvelopeSchema.parse(
        createEnvelope("deviceSync.request", requestValue.data, {
          id,
          correlationId: id
        })
      );
      const result = DeviceSyncIpcResultSchema.parse(
        await ipcRenderer.invoke(DEVICE_SYNC_IPC_CHANNEL, envelope)
      );
      if (!result.ok) throw new Error(result.message);
      return result.value;
    } catch (error) {
      throw new Error(syncErrorMessage(error));
    }
  },
  /** Main asks the window to save and hold open conversations before sync writes them. */
  onConversationLease(
    handler: (request: {
      requestId: string;
      keys: string[];
    }) => Promise<string[]>
  ): () => void {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed =
        DeviceSyncConversationLeaseEventEnvelopeSchema.safeParse(value);
      if (!parsed.success) return;
      const requestId = parsed.data.id;
      void Promise.resolve()
        .then(() => handler({ requestId, keys: parsed.data.payload.keys }))
        .catch(() => [] as string[])
        .then(async (released) => {
          const id = browserId("cmd_conversation_lease");
          await invokeCommand(
            createEnvelope(
              "deviceSync.conversationLeaseResult",
              { requestId, released },
              { id, correlationId: id }
            )
          );
        })
        .catch(() => undefined);
    };
    ipcRenderer.on(IPC_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, listener);
  },
  onConversationsChanged(
    handler: (result: { requestId: string; changed: string[] }) => void
  ): () => void {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed =
        DeviceSyncConversationsChangedEventEnvelopeSchema.safeParse(value);
      if (parsed.success) handler(parsed.data.payload);
    };
    ipcRenderer.on(IPC_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, listener);
  }
};
