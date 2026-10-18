import type {
  ContextCompactionRequest,
  ConversationCheckpoint,
  DeepWriteApi,
  ExtrasChatTask,
  SessionConversationHistoryMessage,
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload,
  UserPromptAttachment
} from "@deepwrite/contracts";

/** One user turn, independent of which agent domain answers it. */
export interface ConversationTurn {
  sessionId: string;
  message: string;
  history: SessionConversationHistoryMessage[];
  /** Summary of the turns older than `history`, if any. */
  checkpoint?: ConversationCheckpoint;
  /** Compact the context before the reply. */
  compaction?: ContextCompactionRequest;
  replaceHistory: boolean;
  attachments: UserPromptAttachment[];
  model: Pick<
    SessionPromptCommandPayload,
    "modelId" | "thinkingLevel" | "temperature"
  >;
}

type WorkspaceTurnFields = Omit<
  SessionPromptCommandPayload,
  | "sessionId"
  | "message"
  | "conversationHistory"
  | "conversationHistoryMode"
  | "conversationCheckpoint"
  | "contextCompaction"
  | "attachments"
  | "modelId"
  | "thinkingLevel"
  | "temperature"
>;

/**
 * Sends a turn to its agent domain: chat runs as a "更多功能" conversation agent
 * through `extrasAgent.run`, everything else through `session.prompt`. Both
 * answer with the same acceptance and the same `agent.*` event stream.
 */
export function submitConversationTurn(
  api: DeepWriteApi,
  turn: ConversationTurn,
  target: { chatTask: ExtrasChatTask } | { workspace: WorkspaceTurnFields }
): Promise<SessionPromptAcceptedPayload> {
  if ("chatTask" in target) {
    return api.extrasAgents.run({
      sessionId: turn.sessionId,
      ...turn.model,
      task: target.chatTask,
      conversation: {
        message: turn.message,
        ...(turn.history.length ? { history: turn.history } : {}),
        ...(turn.replaceHistory ? { historyMode: "replace" as const } : {}),
        ...(turn.checkpoint ? { checkpoint: turn.checkpoint } : {}),
        ...(turn.compaction ? { compaction: turn.compaction } : {}),
        ...(turn.attachments.length ? { attachments: turn.attachments } : {})
      }
    });
  }
  return api.session.prompt({
    sessionId: turn.sessionId,
    message: turn.message,
    ...(turn.history.length ? { conversationHistory: turn.history } : {}),
    ...(turn.replaceHistory
      ? { conversationHistoryMode: "replace" as const }
      : {}),
    ...(turn.checkpoint ? { conversationCheckpoint: turn.checkpoint } : {}),
    ...(turn.compaction ? { contextCompaction: turn.compaction } : {}),
    ...(turn.attachments.length ? { attachments: turn.attachments } : {}),
    ...turn.model,
    ...target.workspace
  });
}

/** A plain copy: Vue proxies cannot cross Electron IPC. */
export function cloneChatTask(task: ExtrasChatTask): ExtrasChatTask {
  if (task.agentId === "chat-project") {
    return {
      agentId: task.agentId,
      profileId: task.profileId,
      input: {
        project: {
          projectType: task.input.project.projectType,
          projectId: task.input.project.projectId
        },
        ...(task.input.webSearchEnabled ? { webSearchEnabled: true } : {})
      }
    };
  }
  if (task.agentId === "chat-normal") {
    return {
      agentId: task.agentId,
      profileId: task.profileId,
      input: task.input.webSearchEnabled ? { webSearchEnabled: true } : {}
    };
  }
  return { agentId: task.agentId, profileId: task.profileId, input: {} };
}
