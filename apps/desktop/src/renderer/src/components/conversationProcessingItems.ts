import type {
  AgentSubagentRun,
  AgentToolTrace,
  ChatContextCompaction,
  ChatMessage
} from "../types/conversation";
import { visibleCompaction } from "./conversationCompactionPresentation";
import { remoteSubagentRuns } from "./conversationRemoteCards";

export type ProcessingItem =
  | { id: string; type: "thinking"; content: string; createdAt: string }
  | { id: string; type: "response"; content: string; createdAt: string }
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt: string }
  | {
      id: string;
      type: "subagent";
      /** The delegating `spawn_subagent` call; one card group per call. */
      toolCallId: string;
      runs: AgentSubagentRun[];
      createdAt: string;
    }
  | {
      id: string;
      type: "compaction";
      compaction: ChatContextCompaction;
      createdAt: string;
    };

function subagentItem(
  toolCallId: string,
  runs: AgentSubagentRun[],
  createdAt: string
): ProcessingItem {
  return {
    id: `subagent:${toolCallId}`,
    type: "subagent",
    toolCallId,
    runs,
    createdAt
  };
}

function lastResponseIndex(items: readonly ProcessingItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === "response") return index;
  }
  return -1;
}

export function processingItems(message: ChatMessage): ProcessingItem[] {
  const items: ProcessingItem[] = [];
  const runs = new Map<string, AgentSubagentRun[]>();
  for (const run of message.subagentRuns?.length
    ? message.subagentRuns
    : remoteSubagentRuns(message)) {
    const group = runs.get(run.parentToolCallId);
    if (group) group.push(run);
    else runs.set(run.parentToolCallId, [run]);
  }
  const placedRuns = new Set<string>();
  const tools = new Map(message.toolCalls?.map((tool) => [tool.id, tool]));
  const compactions = new Map(
    message.contextCompactions
      ?.filter(visibleCompaction)
      .map((item) => [item.id, item])
  );
  const placedCompactions = new Set<string>();

  function appendTool(toolCallId: string, id: string, createdAt: string): void {
    const group = runs.get(toolCallId);
    if (group) {
      if (!placedRuns.has(toolCallId)) {
        items.push(subagentItem(toolCallId, group, createdAt));
        placedRuns.add(toolCallId);
      }
      return;
    }
    const tool = tools.get(toolCallId);
    if (tool) items.push({ id, type: "tool", tool, createdAt });
  }

  if (message.processingSteps?.length) {
    for (const step of message.processingSteps) {
      if (step.type === "tool") {
        appendTool(step.toolCallId, step.id, step.createdAt);
      } else if (step.type === "compaction") {
        const compaction = compactions.get(step.compactionId);
        if (compaction && !placedCompactions.has(compaction.id)) {
          items.push({
            id: step.id,
            type: "compaction",
            compaction,
            createdAt: step.createdAt
          });
          placedCompactions.add(compaction.id);
        }
      } else {
        items.push({ ...step });
      }
    }
  } else {
    if (message.thinking) {
      items.push({
        id: `${message.id}_thinking`,
        type: "thinking",
        content: message.thinking,
        createdAt: message.createdAt
      });
    }
    for (const tool of message.toolCalls ?? []) {
      appendTool(tool.id, `${message.id}_${tool.id}`, tool.requestedAt);
    }
  }

  // Older or partial histories may have a child run without its parent step.
  // Preserve existing step order and insert these cards using their start time.
  for (const [toolCallId, group] of runs) {
    if (placedRuns.has(toolCallId)) continue;
    const createdAt = tools.get(toolCallId)?.requestedAt ?? group[0]!.startedAt;
    const laterIndex = items.findIndex(
      (item) => item.createdAt.localeCompare(createdAt) > 0
    );
    items.splice(
      laterIndex < 0 ? items.length : laterIndex,
      0,
      subagentItem(toolCallId, group, createdAt)
    );
  }
  // Histories saved before compaction markers existed use event time, except
  // that an idle compaction always followed the final model response.
  for (const compaction of compactions.values()) {
    if (placedCompactions.has(compaction.id)) continue;
    const laterIndex = items.findIndex(
      (item) => item.createdAt.localeCompare(compaction.createdAt) > 0
    );
    let insertAt = laterIndex < 0 ? items.length : laterIndex;
    if (compaction.reason === "idle") {
      const responseIndex = lastResponseIndex(items);
      if (responseIndex >= 0) insertAt = responseIndex + 1;
    }
    items.splice(insertAt, 0, {
      id: `compaction:${compaction.id}`,
      type: "compaction",
      compaction,
      createdAt: compaction.createdAt
    });
  }
  if (message.status !== "streaming") {
    const lastResponse = lastResponseIndex(items);
    if (lastResponse >= 0) {
      // The final response is displayed as the assistant's ordinary body.
      items.splice(lastResponse, 1);
    }
  }
  return items;
}
