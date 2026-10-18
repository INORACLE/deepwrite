import { SESSION_PROMPT_MAX_MESSAGE_LENGTH } from "@deepwrite/contracts/renderer";
import type {
  ChatMessage,
  ConversationMessageRewriteRequest
} from "../../types/conversation";

export const CONVERSATION_MESSAGE_MAX_LENGTH =
  SESSION_PROMPT_MAX_MESSAGE_LENGTH;

export interface PreparedConversationMessageRewrite {
  content: string;
  targetContent: string;
  targetCreatedAt: string;
  targetIndex: number;
  targetMessageId: string;
}

export function prepareConversationMessageRewrite(
  messages: readonly ChatMessage[],
  request: ConversationMessageRewriteRequest
): PreparedConversationMessageRewrite | undefined {
  const targetIndex = messages.findIndex(
    (message) => message.id === request.messageId
  );
  const target = messages[targetIndex];
  const content = request.content.trim();
  if (
    targetIndex < 0 ||
    !target ||
    target.role !== "user" ||
    target.status === "streaming" ||
    target.attachments?.length ||
    !content ||
    content.length > CONVERSATION_MESSAGE_MAX_LENGTH
  ) {
    return undefined;
  }
  return {
    content,
    targetContent: target.content,
    targetCreatedAt: target.createdAt,
    targetIndex,
    targetMessageId: target.id
  };
}

export function conversationMessageRewriteIsCurrent(
  messages: readonly ChatMessage[],
  prepared: PreparedConversationMessageRewrite
): boolean {
  const target = messages[prepared.targetIndex];
  return Boolean(
    target &&
    target.id === prepared.targetMessageId &&
    target.role === "user" &&
    target.status !== "streaming" &&
    !target.attachments?.length &&
    target.content === prepared.targetContent &&
    target.createdAt === prepared.targetCreatedAt
  );
}
