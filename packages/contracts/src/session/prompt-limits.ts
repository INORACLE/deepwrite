import { CONTEXT_COMPACTION_BUDGET_MAX_TOKENS } from "./context-compaction-defaults";

// Transport headroom for the largest configurable budget, including ASCII
// prose at roughly four characters per token. Per-run limits use prompt-budget.
export const SESSION_PROMPT_MAX_MESSAGE_LENGTH =
  CONTEXT_COMPACTION_BUDGET_MAX_TOKENS * 4;
