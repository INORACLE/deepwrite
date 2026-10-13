import { createScopedTranslator } from "../../i18n";
import type { SyncStatus } from "@deepwrite/contracts/renderer";
import { syncText } from "./displayText";
import type { ConversationScopeItem } from "./useSyncScope";

const t = createScopedTranslator("extras.deviceSync");

export function syncPresentation(status: SyncStatus) {
  const included = status.items.filter((item) => item.included);
  const uploads = included.filter((item) => item.dirty && !item.remoteDirty);
  const downloads = included.filter((item) => item.remoteDirty && !item.dirty);
  const both = included.filter((item) => item.dirty && item.remoteDirty);
  const problems = status.issues.filter(
    (issue) => issue.reason !== "first-sync"
  );
  const adoptionKeys = [
    ...new Set([...both, ...problems].map((item) => item.key))
  ].filter((key) => !status.config?.excludedKeys.includes(key));
  const peers = status.devices.filter(
    (device) => device.id !== status.deviceId
  );
  const awaiting = peers.filter((device) => !device.receivedCurrent);
  const title = !status.firstSyncConfirmed
    ? t("firstSyncAlignment")
    : status.progress.phase === "failed"
      ? t("latestStatusUnknown")
      : problems.length
        ? t("incompleteItems", { count: problems.length })
        : both.length
          ? t("conflictingItems", { count: both.length })
          : uploads.length
            ? t("pendingUploadCount", {
                count: uploads.length
              })
            : downloads.length
              ? t("pendingDownloadCount", {
                  count: downloads.length
                })
              : !status.lastCheckedAt
                ? t("localCleanRemoteUnchecked")
                : t("devicesSynced");
  const receipt = !peers.length
    ? t("noOtherSyncRecords")
    : awaiting.length
      ? t("devicesNotAcknowledged", {
          devices: awaiting.map((device) => device.name).join("、")
        })
      : t("otherDeviceAcknowledged");
  return { uploads, downloads, both, problems, adoptionKeys, title, receipt };
}

/** One switch in the sync scope list. */
export interface SyncScopeRow {
  key: string;
  title: string;
  included: boolean;
  dirty?: boolean;
  remoteDirty?: boolean;
  disabled?: boolean;
  detail?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function conversationRows(
  items: readonly ConversationScopeItem[]
): SyncScopeRow[] {
  return items.map((item) => {
    const parts = [
      item.localSessions
        ? t("conversationLocalSessions", { count: item.localSessions })
        : "",
      item.remote?.sessions
        ? t("conversationRemoteSessions", {
            count: item.remote.sessions,
            size: formatSize(item.remote.bytes)
          })
        : ""
    ].filter(Boolean);
    return {
      key: item.key,
      title: item.title,
      included: item.included,
      disabled: item.disabled,
      detail: item.disabled
        ? t("conversationWorkPaused")
        : parts.join(" · ") || t("conversationNone")
    };
  });
}

/** Status lines for the conversation group: peers, the last run and what is left for later. */
export function conversationMessages(status: SyncStatus): string[] {
  const conversations = status.conversations;
  if (!conversations) return [];
  const messages: string[] = [];
  if (conversations.enabledKeys.length && !conversations.remoteDevices)
    messages.push(t("conversationsNoRemoteDevice"));
  if (conversations.lastRun)
    messages.push(
      t("conversationsLastRun", {
        uploaded: conversations.lastRun.uploaded,
        downloaded: conversations.lastRun.downloaded
      })
    );
  for (const issue of conversations.issues)
    messages.push(
      [issue.title, syncText({ code: issue.code })].filter(Boolean).join("：")
    );
  return messages;
}
