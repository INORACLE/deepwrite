import type { AgentConversationPersistenceSnapshot } from "./useAgentConversation.test-support";
import { SESSION_PROMPT_MAX_MESSAGE_LENGTH } from "@deepwrite/contracts/renderer";
import {
  createDeferredApi,
  createEditProposal,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  storedConversation,
  useAgentConversation
} from "./useAgentConversation.test-support";

function rewriteSnapshot(): AgentConversationPersistenceSnapshot {
  const createdAt = "2026-08-25T08:00:00.000Z";
  return {
    version: 1,
    activeSessionId: "session-history-rewrite",
    conversations: [
      {
        ...storedConversation(
          "session-history-rewrite",
          createdAt,
          "第一条问题"
        ),
        createdAt,
        messages: [
          {
            id: "user-before",
            role: "user",
            content: "第一条问题",
            createdAt,
            status: "completed"
          },
          {
            id: "assistant-before",
            role: "assistant",
            content: "第一条回答",
            createdAt: "2026-08-25T08:01:00.000Z",
            status: "completed"
          },
          {
            id: "user-target",
            role: "user",
            content: "需要修改的原问题",
            createdAt: "2026-08-25T08:02:00.000Z",
            status: "completed"
          },
          {
            id: "assistant-discarded",
            role: "assistant",
            content: "这条回答和审批卡片都应删除",
            createdAt: "2026-08-25T08:03:00.000Z",
            status: "completed",
            runId: "run_edit_1",
            editProposals: [createEditProposal({ status: "accepted" })]
          },
          {
            id: "user-discarded",
            role: "user",
            content: "更晚的问题也应删除",
            createdAt: "2026-08-25T08:04:00.000Z",
            status: "completed"
          }
        ]
      }
    ]
  };
}

describe("agent conversation controller: history rewrite", () => {
  it("replaces a middle question with only its prefix and never restores the discarded branch", async () => {
    const deferred = createDeferredApi();
    const persisted: AgentConversationPersistenceSnapshot[] = [];
    const controller = useAgentConversation({
      api: () => deferred.api,
      initialPersistenceSnapshot: rewriteSnapshot(),
      onPersistenceSnapshot(snapshot) {
        persisted.push(snapshot);
      }
    });
    controller.applyModelSettings({
      defaultModelId: "writer-current",
      models: [
        {
          id: "writer-current",
          label: "Writer Current",
          provider: "openai",
          modelId: "writer-current-model",
          api: "openai-responses",
          baseUrl: "https://api.example.test/v1",
          reasoning: true,
          defaultThinkingLevel: "high",
          thinkingLevelOptions: ["low", "high"],
          temperatureOptions: [0.2, 0.7, 1],
          hasApiKey: true
        }
      ]
    });
    controller.selectApprovalMode("auto-approve");
    controller.draft.value = "主输入框里尚未发送的草稿";
    persisted.length = 0;
    const sourceSessionId = controller.sessionId.value;
    const sourceCreatedAt =
      controller.capturePersistenceSnapshot().conversations[0]!.createdAt;
    const currentDocument = {
      ...document,
      content: "这是当前编辑器和磁盘上的最新作品内容。"
    };
    const revisedContent = `修改后的问题\n${"完整保留长问题。".repeat(5_000)}`;

    const sending = controller.resendMessage(
      {
        messageId: "user-target",
        content: `  ${revisedContent}  `
      },
      currentDocument
    );

    expect(deferred.prompts).toHaveLength(1);
    expect(deferred.prompts[0]).toMatchObject({
      sessionId: sourceSessionId,
      message: revisedContent,
      conversationHistoryMode: "replace",
      conversationHistory: [
        {
          role: "user",
          content: "第一条问题",
          createdAt: "2026-08-25T08:00:00.000Z"
        },
        {
          role: "assistant" as const,
          content: "第一条回答",
          createdAt: "2026-08-25T08:01:00.000Z"
        }
      ],
      modelId: "writer-current",
      thinkingLevel: "high",
      writeApprovalMode: "auto-approve",
      workspaceContext: {
        activeResource: {
          content: "这是当前编辑器和磁盘上的最新作品内容。"
        }
      }
    });
    expect(controller.draft.value).toBe("主输入框里尚未发送的草稿");
    expect(controller.messages.value.map((message) => message.content)).toEqual(
      ["第一条问题", "第一条回答", revisedContent, ""]
    );
    expect(controller.messages.value.at(-1)).toMatchObject({
      role: "assistant",
      status: "streaming",
      activityOnly: true
    });
    expect(controller.messages.value.at(-2)?.id).not.toBe("user-target");
    expect(persisted).toHaveLength(1);
    expect(
      persisted[0]?.conversations[0]?.messages.map((message) => message.content)
    ).toEqual(["第一条问题", "第一条回答", revisedContent]);

    const rewrittenSnapshot = controller.capturePersistenceSnapshot();
    expect(rewrittenSnapshot.activeSessionId).toBe(sourceSessionId);
    expect(rewrittenSnapshot.conversations[0]?.createdAt).toBe(sourceCreatedAt);
    expect(
      rewrittenSnapshot.conversations[0]?.messages.map(
        (message) => message.content
      )
    ).toEqual(["第一条问题", "第一条回答", revisedContent]);

    deferred.rejectPrompt(0, new Error("模拟运行启动失败"));
    await expect(sending).resolves.toBe(true);
    expect(controller.messages.value.map((message) => message.content)).toEqual(
      ["第一条问题", "第一条回答", revisedContent]
    );
    expect(controller.conversationError.value).toBe("模拟运行启动失败");

    controller.draft.value = "启动失败后继续提问";
    const recoverySend = controller.sendMessage(currentDocument);
    expect(deferred.prompts[1]).toMatchObject({
      message: "启动失败后继续提问",
      conversationHistoryMode: "replace",
      conversationHistory: [
        expect.objectContaining({ content: "第一条问题" }),
        expect.objectContaining({ content: "第一条回答" }),
        expect.objectContaining({ content: revisedContent })
      ]
    });
    deferred.resolveAccepted(1, {
      sessionId: controller.sessionId.value,
      runId: "run_history_rewrite_recovery",
      acceptedAt: "2026-08-25T09:05:00.000Z",
      runtime
    });
    await recoverySend;
    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId: controller.sessionId.value,
          runId: "run_history_rewrite_recovery",
          messageId: "assistant-history-rewrite-recovery",
          role: "assistant" as const,
          content: "恢复请求已完成。",
          runtime
        },
        eventOptions(
          controller.sessionId.value,
          "run_history_rewrite_recovery",
          "event-history-rewrite-recovery"
        )
      )
    );
    controller.draft.value = "正常连续提问";
    const continuousSend = controller.sendMessage(currentDocument);
    expect(deferred.prompts[2]).not.toHaveProperty("conversationHistoryMode");
    deferred.resolveAccepted(2, {
      sessionId: controller.sessionId.value,
      runId: "run_history_rewrite_continuous",
      acceptedAt: "2026-08-25T09:06:00.000Z",
      runtime
    });
    await continuousSend;
    controller.dispose();
  });

  it("explicitly replaces cached context when rewriting the first question", async () => {
    const deferred = createDeferredApi();
    const snapshot = rewriteSnapshot();
    snapshot.conversations[0]!.messages =
      snapshot.conversations[0]!.messages.slice(0, 2);
    const controller = useAgentConversation({
      api: () => deferred.api,
      initialPersistenceSnapshot: snapshot
    });

    const sending = controller.resendMessage(
      { messageId: "user-before", content: "从第一条重新开始" },
      document
    );

    expect(deferred.prompts[0]).toMatchObject({
      message: "从第一条重新开始",
      conversationHistoryMode: "replace"
    });
    expect(deferred.prompts[0]).not.toHaveProperty("conversationHistory");
    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_history_rewrite_first",
      acceptedAt: "2026-08-25T09:00:00.000Z",
      runtime
    });
    await expect(sending).resolves.toBe(true);
    expect(controller.messages.value.map((message) => message.content)).toEqual(
      ["从第一条重新开始", ""]
    );
    expect(controller.messages.value.at(-1)).toMatchObject({
      role: "assistant",
      status: "streaming",
      activityOnly: true
    });
    controller.dispose();
  });

  it("rejects attachment prompts, invalid content, pending reviews, and active runs", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      initialPersistenceSnapshot: rewriteSnapshot()
    });
    controller.messages.value[0]!.attachments = [
      {
        id: "attachment-1",
        name: "reference.txt",
        kind: "text",
        mediaType: "text/plain",
        size: 12
      }
    ];

    await expect(
      controller.resendMessage(
        { messageId: "user-before", content: "不能重放附件" },
        document
      )
    ).resolves.toBe(false);
    await expect(
      controller.resendMessage(
        { messageId: "user-target", content: "   " },
        document
      )
    ).resolves.toBe(false);
    await expect(
      controller.resendMessage(
        {
          messageId: "user-target",
          content: "长".repeat(SESSION_PROMPT_MAX_MESSAGE_LENGTH + 1)
        },
        document
      )
    ).resolves.toBe(false);
    expect(deferred.prompts).toHaveLength(0);

    controller.messages.value[3]!.editProposals = [createEditProposal()];
    expect(controller.canRewriteHistory.value).toBe(false);
    await expect(
      controller.resendMessage(
        { messageId: "user-target", content: "等待审批" },
        document
      )
    ).resolves.toBe(false);

    controller.messages.value[3]!.editProposals = [
      createEditProposal({ status: "accepted" })
    ];
    controller.draft.value = "先启动普通请求";
    const normalSend = controller.sendMessage(document);
    expect(controller.canRewriteHistory.value).toBe(false);
    await expect(
      controller.resendMessage(
        { messageId: "user-target", content: "运行中不可修改" },
        document
      )
    ).resolves.toBe(false);
    expect(deferred.prompts).toHaveLength(1);
    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_history_rewrite_busy",
      acceptedAt: "2026-08-25T09:10:00.000Z",
      runtime
    });
    await normalSend;
    controller.dispose();
  });
});
