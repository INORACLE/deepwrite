import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryStageSchema,
  PROMPT_ATTACHMENT_MAX_ITEMS,
  SessionPromptCommandPayloadSchema,
  createEnvelope
} from "@deepwrite/contracts";
import { ConversationDatabase } from "./conversation-storage/database";
import { createConversationHistoryWrite } from "../renderer/src/utils/conversationHistoryWriter";
import { loadConversationHistoryRecord } from "../renderer/src/utils/conversationHistoryRecordLoader";
import { useAgentConversation } from "../renderer/src/composables/useAgentConversation";
import {
  createDeferredApi,
  document,
  runtime
} from "../renderer/src/composables/useAgentConversation.test-support";

it("saves, reloads and continues a million-character message with attachment names intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-long-prompt-"));
  const path = join(directory, "history.sqlite");
  let database = new ConversationDatabase(path);
  let restored;
  const key = "conversation-history:long-prompt";
  const date = "2026-10-16T00:00:00.000Z";
  const agent = createDeferredApi();
  const history = {
    commit: async (batch) =>
      database.commit(ConversationHistoryBatchSchema.parse(batch)),
    stage: async (batch) =>
      database.stage(ConversationHistoryStageSchema.parse(batch)),
    session: async (query) => database.session(query),
    messages: async (query) => database.messages(query),
    detail: async (query) => database.detail(query),
    metadataDetail: async (query) => database.metadataDetail(query)
  };
  const flushPersistence = async () => {
    const changes = controller.capturePersistenceChanges();
    if (!changes.conversations.length) return;
    await createConversationHistoryWrite(history, key, changes)();
    controller.acknowledgePersistenceChanges(changes.revision);
  };
  const controller = useAgentConversation({
    api: () => agent.api,
    flushPersistence,
    contextCompactionBudgetTokens: () => 2_000_000
  });
  try {
    const message = "开始" + "字".repeat(1_000_000 - 4) + "结尾";
    const attachments = Array.from(
      { length: PROMPT_ATTACHMENT_MAX_ITEMS },
      (_, index) => ({
        id: `attachment-${index}`,
        kind: "text",
        name: `${index}${"附件".repeat(120)}`.slice(0, 240),
        mediaType: "text/plain",
        size: 6,
        content: "资料"
      })
    );
    const activeDocument = { ...document, domain: "skill" };
    const sessionId = controller.sessionId.value;
    controller.draft.value = message;
    const sending = controller.sendMessage(activeDocument, [], {}, attachments);
    await vi.waitFor(() => expect(agent.promptCount()).toBe(1));
    expect(
      SessionPromptCommandPayloadSchema.parse(agent.prompts[0]).message
    ).toBe(message);
    agent.resolveAccepted(0, {
      sessionId,
      runId: "long-input-run",
      acceptedAt: date,
      runtime
    });
    await sending;
    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId: "long-input-run",
          messageId: "long-input-answer",
          role: "assistant",
          content: "已读取完整长消息。",
          runtime
        },
        {
          id: "long-input-completed",
          context: { sessionId, runId: "long-input-run" }
        }
      )
    );
    await flushPersistence();
    controller.dispose();
    database.close();
    database = new ConversationDatabase(path);
    const record = await loadConversationHistoryRecord(history, key, sessionId);
    expect(record.messages[0].content).toBe(message);
    expect(record.messages[0].attachments.map((item) => item.name)).toEqual(
      attachments.map((item) => item.name)
    );
    restored = useAgentConversation({
      api: () => agent.api,
      contextCompactionBudgetTokens: () => 2_000_000,
      initialPersistenceSnapshot: {
        version: 1,
        activeSessionId: sessionId,
        conversations: [record]
      }
    });
    restored.draft.value = "继续处理刚才的长文本";
    const continuing = restored.sendMessage(activeDocument);
    expect(agent.promptCount()).toBe(2);
    const payload = SessionPromptCommandPayloadSchema.parse(agent.prompts[1]);
    expect(payload.conversationHistory).toHaveLength(2);
    const restoredContent = payload.conversationHistory[0].content;
    expect(restoredContent).toContain(message);
    expect(restoredContent.length).toBeGreaterThan(1_000_000);
    for (const attachment of attachments)
      expect(restoredContent).toContain(attachment.name);
    agent.resolveAccepted(1, {
      sessionId,
      runId: "long-input-follow-up",
      acceptedAt: date,
      runtime
    });
    await continuing;
    expect(restored.conversationError.value).toBeNull();
  } finally {
    controller.dispose();
    restored?.dispose();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
