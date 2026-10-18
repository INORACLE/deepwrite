import { describe, expect, it } from "vitest";
import { ExtrasAgentConversationSchema } from "../extras-agent/tasks";
import { SessionPromptCommandPayloadSchema } from "./commands";
import { SESSION_PROMPT_MAX_MESSAGE_LENGTH } from "./prompt-limits";

describe("conversation prompt length", () => {
  it.each([
    ["workspace", SessionPromptCommandPayloadSchema],
    ["chat", ExtrasAgentConversationSchema]
  ] as const)("enforces the same message boundary for %s", (_, schema) => {
    const message = "字".repeat(SESSION_PROMPT_MAX_MESSAGE_LENGTH);
    expect(
      schema.safeParse({ sessionId: "session", message: `  ${message}\n` })
        .success
    ).toBe(true);
    const result = schema.safeParse({
      sessionId: "session",
      message: `${message}字`
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ code: "too_big", path: ["message"] })
      ]);
    }
  });
});
