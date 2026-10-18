import { SESSION_PROMPT_MAX_MESSAGE_LENGTH } from "./prompt-limits";

// Transport limits, not model limits. The runtime summarizes complete restored
// messages in bounded requests before the first model turn.
export const SESSION_CONVERSATION_HISTORY_MAX_MESSAGES = 2_000;
// Leave room for the localized attachment-name note added during restoration.
export const SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH =
  SESSION_PROMPT_MAX_MESSAGE_LENGTH + 4_096;
export const SESSION_CONVERSATION_HISTORY_MAX_CONTENT_LENGTH =
  SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH * 4;
