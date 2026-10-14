import { describe, expect, it } from "vitest";
import { createPinia } from "pinia";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { parseStoredMessage } from "../composables/agent-conversation/parse-message";
import { processingItems } from "./conversationProcessingItems";
import { approvalItemsForMessage } from "./conversationToolPresentation";
import ConversationMessageItem from "./ConversationMessageItem.vue";

const at = "2026-10-12T08:00:01.000Z";
// A message as device sync stores it after receiving it from another desktop.
const stored = {
  id: "msg_a",
  role: "assistant",
  content: "写好了",
  createdAt: "2026-10-12T08:00:05.000Z",
  status: "completed",
  runId: "run_1",
  processingSteps: [
    { id: "s1", type: "tool", toolCallId: "call_spawn", createdAt: at },
    { id: "s2", type: "tool", toolCallId: "call_write", createdAt: at },
    { id: "s3", type: "response", content: "写好了", createdAt: at }
  ],
  toolCalls: [
    {
      id: "call_spawn",
      name: "spawn_subagent",
      args: {},
      argumentsText: '{"task":"审校"}',
      status: "completed",
      requestedAt: at
    },
    {
      id: "call_write",
      name: "write_document",
      args: {},
      status: "completed",
      requestedAt: at
    }
  ],
  remote: {
    recordHash: "a".repeat(64),
    device: "电脑A",
    proposals: [
      {
        id: "proposal_1",
        title: "第一章",
        summary: "新增正文",
        status: "pending",
        additions: 12,
        deletions: 1
      }
    ],
    subagents: [
      {
        id: "sub_1",
        name: "审校",
        toolCallId: "call_spawn",
        status: "completed",
        task: "检查错字",
        summary: "没有问题",
        output: "全文无错字"
      }
    ]
  }
};
const synced = () => parseStoredMessage(stored)!;

describe("cards of a conversation received from another device", () => {
  it("puts the subagent card back where the delegating call was made", () => {
    const items = processingItems(synced());
    expect(items.map((item) => item.type)).toEqual(["subagent", "tool"]);
    const card = items[0];
    expect(card?.type === "subagent" && card.runs[0]).toMatchObject({
      name: "审校",
      task: "检查错字",
      status: "completed",
      summary: "没有问题",
      output: "全文无错字"
    });
  });

  it("shows the proposal as a read-only approval card of that device", async () => {
    const message = synced();
    expect(approvalItemsForMessage(message, [])).toMatchObject([
      {
        type: "edit-proposal",
        remoteDevice: "电脑A",
        canDiscard: false,
        proposal: { title: "第一章", status: "pending", additions: 12 }
      }
    ]);
    const app = createSSRApp({
      render: () => h(ConversationMessageItem, { message })
    });
    app.use(createPinia());
    const html = await renderToString(app);
    expect(html).toContain("在电脑A上待审核");
    expect(html).toContain("这个提案只能在电脑A上审核。");
    expect(html).toContain("来自电脑A");
    expect(html).not.toContain("edit-review-button");
    expect(html).not.toContain("approval-target-button");
  });
});
