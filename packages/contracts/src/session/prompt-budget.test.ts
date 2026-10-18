import { describe, expect, it } from "vitest";
import {
  assertConversationPromptBudget,
  conversationPromptBudgetError,
  conversationPromptTokenLimit,
  estimateConversationPromptTokens
} from "./prompt-budget";
import { SESSION_PROMPT_MAX_MESSAGE_LENGTH } from "./prompt-limits";
import { CONTEXT_COMPACTION_BUDGET_MAX_TOKENS } from "./context-compaction-defaults";

describe("conversation prompt budget", () => {
  it.each([16_000, 64_000, 160_000, 2_000_000])(
    "uses the configured %s-token budget with a ten-percent reserve",
    (budget) => {
      const limit = conversationPromptTokenLimit(budget);
      expect(limit).toBe(Math.floor(budget * 0.9));
      expect(
        conversationPromptBudgetError({ message: "字".repeat(limit) }, budget)
      ).toBeUndefined();
      expect(
        conversationPromptBudgetError(
          { message: "字".repeat(limit + 1) },
          budget
        )
      ).toMatchObject({
        code: "session.prompt_budget_exceeded",
        details: {
          budgetTokens: budget,
          maxInputTokens: limit,
          inputTokens: limit + 1
        }
      });
    }
  );

  it("budgets estimated tokens rather than treating ASCII and Chinese as equal", () => {
    expect(
      conversationPromptBudgetError({ message: "a".repeat(57_600) }, 16_000)
    ).toBeUndefined();
    expect(
      conversationPromptBudgetError({ message: "字".repeat(57_600) }, 16_000)
    ).toBeDefined();
    const largest = "a".repeat(
      conversationPromptTokenLimit(CONTEXT_COMPACTION_BUDGET_MAX_TOKENS) * 4
    );
    expect(largest.length).toBeLessThan(SESSION_PROMPT_MAX_MESSAGE_LENGTH);
    expect(
      conversationPromptBudgetError(
        { message: largest },
        CONTEXT_COMPACTION_BUDGET_MAX_TOKENS
      )
    ).toBeUndefined();
  });

  it("counts text attachments and images within the same message budget", () => {
    const message = "字".repeat(10_000);
    const attachments = [
      {
        id: "text",
        kind: "text" as const,
        name: "source.txt",
        mediaType: "text/plain",
        size: 15_000,
        content: "字".repeat(5_000)
      },
      {
        id: "image",
        kind: "image" as const,
        name: "image.png",
        mediaType: "image/png" as const,
        size: 7,
        data: "aW52YWxpZA=="
      }
    ];
    expect(conversationPromptBudgetError({ message }, 16_000)).toBeUndefined();
    expect(
      estimateConversationPromptTokens({ message, attachments })
    ).toBeGreaterThan(16_200);
    expect(() =>
      assertConversationPromptBudget({ message, attachments }, 16_000)
    ).toThrow("预留 10% 余量");
    expect(() =>
      assertConversationPromptBudget({ message, attachments }, 32_000)
    ).not.toThrow();
  });
});
