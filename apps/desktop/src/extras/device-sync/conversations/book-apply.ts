import {
  conversationSyncMessageSchema,
  type ConversationNativeSession,
  type ConversationSessionPlan,
  type ConversationSyncEntry,
  type ConversationSyncMessage,
  type ConversationSyncSession,
  type SyncRuntime
} from "@deepwrite/contracts";
import {
  confirmedFrom,
  latestTime,
  type ConversationBookPort,
  type ConversationBookResult,
  type ConversationSessionWrite
} from "./book-port";
import type { ConversationRemote } from "./remote";

export interface PlannedConversationSession {
  id: string;
  plan: ConversationSessionPlan;
  merged: ConversationSyncSession;
  native: ConversationNativeSession | null;
}

/**
 * Writes the merged sessions this device does not hold yet. A session that is applied publishes the merge;
 * one that is not keeps this device's own view, so a later sync merges it again.
 */
export async function applyConversationPlans(input: {
  spaceId: string;
  remote: ConversationRemote;
  port: ConversationBookPort;
  runtime: SyncRuntime;
  planned: PlannedConversationSession[];
  markers: ReadonlyMap<string, string>;
  /** Contents of records uploaded by this run, which need no download. */
  contents: ReadonlyMap<string, string>;
  /** Name of the device each received record came from. */
  devices: ReadonlyMap<string, string>;
  lease(): Promise<boolean>;
  publish: Map<string, ConversationSyncSession>;
  result: ConversationBookResult;
}): Promise<void> {
  const { spaceId, remote, port, runtime, markers, contents, devices, result } =
    input;
  const writes = input.planned;
  if (writes.length) {
    if (!(await input.lease())) {
      result.issue = "conversationsBusy";
    } else {
      const records = new Map<string, ConversationSyncMessage>();
      const recordFor = async (entry: ConversationSyncEntry) => {
        const cached = records.get(entry.record.hash);
        if (cached) return cached;
        const text =
          contents.get(entry.record.hash) ??
          (await remote.readText(spaceId, entry.record));
        if (runtime.hash(text) !== entry.record.hash)
          throw new Error("同步文件校验失败。");
        const parsed = conversationSyncMessageSchema.parse(JSON.parse(text));
        records.set(entry.record.hash, parsed);
        return parsed;
      };
      const requests: ConversationSessionWrite[] = [];
      for (const { id, plan, merged } of writes)
        requests.push({
          id,
          expectedMarker: markers.get(id) ?? null,
          createdAt: merged.createdAt,
          updatedAt: latestTime(merged),
          restore: plan.restore,
          archive: plan.archive,
          remove: plan.remove,
          put: await Promise.all(
            plan.put.map(async (entry) => ({
              record: await recordFor(entry),
              hash: entry.record.hash,
              device: devices.get(entry.record.hash) ?? "其他设备"
            }))
          ),
          order: plan.order
        });
      const outcomes = new Map(
        (await port.apply(requests)).map((outcome) => [outcome.id, outcome])
      );
      for (const { id, plan, merged, native } of writes) {
        const outcome = outcomes.get(id);
        if (outcome?.status !== "applied") {
          result.issue ??= "conversationsChanged";
          continue;
        }
        input.publish.set(id, merged);
        result.downloaded++;
        result.sessions[id] = {
          ref: null,
          marker: outcome.marker ?? "",
          confirmed: plan.archive
            ? {
                native: port.archivedStatus,
                ids:
                  port.archivedStatus === "absent"
                    ? []
                    : confirmedFrom(native).ids
              }
            : { native: "live", ids: plan.order }
        };
      }
    }
  }
}
