import { describe, expect, it } from "vitest";
import { SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH } from "@deepwrite/contracts/renderer";
import type { ChatMessage } from "../../types/conversation";
import {
  applyContextCompactionEvent,
  latestConversationCheckpoint,
  parseStoredContextCompactions
} from "./context-compaction";
import { buildConversationRestore } from "./history";
import { createTrackedMessages } from "./message-mutations";

const time = "2026-09-28T00:00:00.000Z";
const runtime = {
  mode: "local-faux" as const,
  provider: "example",
  model: "test"
};
function message(
  role: ChatMessage["role"],
  runId: string,
  content = "正文"
): ChatMessage {
  return {
    role,
    id: `${role}-${runId}`,
    runId,
    content,
    createdAt: time,
    status: "completed"
  };
}
const checkpoint = {
  summary: "约束与剧情结论",
  firstKeptRunId: "two",
  createdAt: time,
  tokensBefore: 99_000
};

describe("persisted context checkpoints", () => {
  it("copies a reactive checkpoint before sending the next turn across IPC", () => {
    const tracked = createTrackedMessages([
      message("user", "one"),
      message("assistant", "one")
    ]);
    const assistant = tracked.messages.value[1]!;
    const withRefs = {
      ...checkpoint,
      refs: {
        read: ["chapter:one"],
        proposed: [],
        skills: [],
        materials: []
      }
    };
    applyContextCompactionEvent(
      assistant,
      {
        runId: "one",
        sessionId: "session",
        messageId: assistant.id,
        runtime,
        phase: "completed",
        reason: "manual",
        level: "summary",
        checkpoint: withRefs
      },
      "summary",
      time
    );

    const restore = buildConversationRestore(tracked.messages.value);
    expect(restore.checkpoint).toEqual(withRefs);
    expect(() => structuredClone(restore)).not.toThrow();
  });

  it("keeps the latest valid checkpoint after many prune passes and JSON reload", () => {
    const item = message("assistant", "three");
    applyContextCompactionEvent(
      item,
      {
        runId: "three",
        sessionId: "session",
        messageId: item.id,
        runtime,
        phase: "completed",
        reason: "threshold",
        level: "summary",
        checkpoint
      },
      "summary",
      time
    );
    for (let index = 0; index < 12; index++)
      applyContextCompactionEvent(
        item,
        {
          runId: "three",
          sessionId: "session",
          messageId: item.id,
          runtime,
          phase: "completed",
          reason: "run_limit",
          level: "prune",
          tokensAfter: 500
        },
        String(index),
        time
      );
    item.contextCompactions = parseStoredContextCompactions(
      JSON.parse(JSON.stringify(item.contextCompactions))
    );
    const messages = [
      message("user", "one"),
      message("assistant", "one"),
      message("user", "two"),
      message("assistant", "two"),
      message("user", "three"),
      item
    ];
    const restored = buildConversationRestore(messages);
    expect(restored.checkpoint).toEqual(checkpoint);
    expect(restored.history.map((entry) => entry.runId)).toEqual([
      "two",
      "two",
      "three",
      "three"
    ]);
    expect(item.contextCompactions).toHaveLength(8);
  });

  it("keeps complete long messages and more than 80 unsummarized messages", () => {
    const long = "前".repeat(30_000) + "末尾要求";
    const messages = Array.from({ length: 90 }, (_, index) =>
      message(
        index % 2 ? "assistant" : "user",
        String(index),
        index === 0 ? long : "保留"
      )
    );
    const restored = buildConversationRestore(messages);
    expect(restored.history).toHaveLength(90);
    expect(restored.history[0]?.content).toBe(long);
  });

  it("does not invent a restore boundary when an old run cannot be located", () => {
    const item = message("assistant", "three");
    item.contextCompactions = [
      {
        id: "c",
        status: "completed",
        reason: "manual",
        level: "summary",
        createdAt: time,
        checkpoint
      }
    ];
    expect(
      latestConversationCheckpoint([message("user", "one"), item])?.keepFrom
    ).toBe(0);
    expect(
      buildConversationRestore([message("user", "one")]).checkpoint
    ).toBeUndefined();
  });

  it("fails explicitly rather than truncate an oversized restored payload", () => {
    expect(() =>
      buildConversationRestore([
        message(
          "user",
          "one",
          "字".repeat(SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH + 1)
        )
      ])
    ).toThrow("未截断或发送");
  });
});
