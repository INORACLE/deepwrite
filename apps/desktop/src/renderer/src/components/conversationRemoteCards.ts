import type {
  AgentEditProposal,
  AgentSubagentRun,
  ChatMessage
} from "../types/conversation";

/**
 * A message received through device sync keeps only summaries of its subagents and proposals. These rebuild
 * the cards from them, read-only: the full process and the review stay on the device that made them.
 */
export function remoteSubagentRuns(message: ChatMessage): AgentSubagentRun[] {
  const remote = message.remote;
  if (!remote?.subagents?.length || message.subagentRuns?.length) return [];
  return remote.subagents.flatMap((subagent) =>
    subagent.toolCallId
      ? [
          {
            parentToolCallId: subagent.toolCallId,
            subagentRunId: subagent.id,
            subagentId: subagent.id,
            name: subagent.name,
            task: subagent.task ?? "",
            status: subagent.status,
            runtime: message.runtime ?? {
              provider: remote.device,
              model: remote.device,
              mode: "provider" as const
            },
            ...(subagent.output ? { output: subagent.output } : {}),
            ...(subagent.summary ? { summary: subagent.summary } : {}),
            toolCalls: [],
            processingSteps: [],
            startedAt: message.createdAt,
            completedAt: message.createdAt
          }
        ]
      : []
  );
}

export function remoteEditProposals(message: ChatMessage): AgentEditProposal[] {
  const remote = message.remote;
  if (!remote?.proposals?.length) return [];
  return remote.proposals.map((proposal) => ({
    id: proposal.id,
    runId: message.runId ?? message.id,
    workspaceId: "",
    stageId: "library",
    documentId: "",
    title: proposal.title || proposal.summary,
    summary: proposal.summary,
    status: proposal.status === "discarded" ? "accepted" : proposal.status,
    toolCallIds: [],
    additions: proposal.additions,
    deletions: proposal.deletions,
    hunks: [],
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    ...(proposal.status === "discarded"
      ? {
          discardState: {
            status: "discarded" as const,
            message: "",
            updatedAt: message.createdAt
          }
        }
      : {})
  }));
}
