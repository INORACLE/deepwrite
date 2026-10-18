import {
  SESSION_PROMPT_MAX_MESSAGE_LENGTH,
  conversationPromptBudgetError
} from "@deepwrite/contracts/renderer";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import { locale, t } from "../i18n";
import { formatError } from "../i18n/errors";

export function conversationPromptError(
  content: string,
  budgetTokens?: number,
  attachments: readonly UserPromptAttachment[] = []
): string | undefined {
  const length = content.trim().length;
  if (length > SESSION_PROMPT_MAX_MESSAGE_LENGTH)
    return t("workspace.sendMessage.messageTooLong", {
      limit: SESSION_PROMPT_MAX_MESSAGE_LENGTH.toLocaleString(locale.value),
      length: length.toLocaleString(locale.value)
    });
  const error = conversationPromptBudgetError(
    { message: content, attachments },
    budgetTokens
  );
  return error ? formatError(error, error.message) : undefined;
}
