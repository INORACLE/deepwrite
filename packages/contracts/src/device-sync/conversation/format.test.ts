import { describe, expect, it } from "vitest";
import { stableSyncJson } from "../value";
import {
  conversationSyncBookSchema,
  conversationSyncCommitSchema,
  conversationSyncMessageSchema,
  conversationSyncSessionSchema
} from "./schemas";

/**
 * The phone app keeps the same samples and bytes in
 * `tests/device-sync-conversation-format.test.ts`; both must change together.
 */
const h = (c: string) => c.repeat(64);
const SAMPLES = {
  message: {
    schemaVersion: 1,
    kind: "deepwrite.conversation-message",
    id: "msg_1",
    role: "assistant",
    content: "第一章写好了。",
    createdAt: "2026-10-12T08:00:01.000Z",
    status: "completed",
    runId: "run_1",
    model: {
      configId: "model_writer-1",
      provider: "custom",
      model: "writer-v1"
    },
    thinking: "先看大纲。",
    steps: [
      {
        id: "step_1",
        type: "thinking",
        content: "先看大纲。",
        createdAt: "2026-10-12T08:00:00.000Z"
      },
      {
        id: "step_2",
        type: "tool",
        toolCallId: "call_1",
        createdAt: "2026-10-12T08:00:00.500Z"
      },
      {
        id: "step_3",
        type: "response",
        content: "第一章写好了。",
        createdAt: "2026-10-12T08:00:01.000Z"
      }
    ],
    tools: [
      {
        id: "call_1",
        name: "read_document",
        status: "completed",
        inputSummary: "大纲",
        resultSummary: "已读取"
      }
    ],
    proposals: [
      {
        id: "proposal_1",
        title: "第一章",
        summary: "新增正文",
        status: "accepted",
        additions: 12,
        deletions: 0
      }
    ],
    subagents: [
      {
        id: "sub_1",
        name: "审校",
        toolCallId: "call_2",
        status: "completed",
        task: "检查错字",
        summary: "没有问题"
      }
    ],
    compactions: [
      {
        id: "compaction_1",
        summary: "前文摘要",
        createdAt: "2026-10-12T07:59:00.000Z"
      }
    ],
    attachments: [
      {
        id: "attachment_1",
        name: "设定.md",
        kind: "text",
        mediaType: "text/markdown",
        size: 120
      }
    ],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 120
    }
  },
  session: {
    schemaVersion: 1,
    kind: "deepwrite.conversation-session",
    id: "session_1",
    createdAt: "2026-10-12T07:58:00.000Z",
    state: { deleted: false, at: "2026-10-12T07:58:00.000Z" },
    messages: [
      {
        id: "msg_0",
        parent: null,
        createdAt: "2026-10-12T08:00:00.000Z",
        record: { hash: h("1"), pack: h("2") },
        bytes: 180,
        at: "2026-10-12T08:00:02.000Z"
      },
      {
        id: "msg_1",
        parent: "msg_0",
        createdAt: "2026-10-12T08:00:01.000Z",
        record: { hash: h("3"), pack: h("2") },
        bytes: 900,
        at: "2026-10-12T08:00:02.000Z"
      }
    ],
    removed: [{ id: "msg_x", at: "2026-10-12T08:10:00.000Z" }]
  },
  book: {
    schemaVersion: 1,
    kind: "deepwrite.conversation-book",
    key: "book:book-a1b2c3d4",
    sessions: {
      session_1: {
        ref: { hash: h("4"), pack: h("5") },
        messages: 2,
        bytes: 1080,
        deleted: false
      }
    }
  },
  commit: {
    schemaVersion: 1,
    kind: "deepwrite.conversation-commit",
    spaceId: "space_1",
    deviceId: "device_pc",
    deviceName: "电脑",
    sequence: 3,
    createdAt: "2026-10-12T08:11:00.000Z",
    books: {
      "book:book-a1b2c3d4": {
        ref: { hash: h("6"), pack: h("7") },
        sessions: 1,
        bytes: 1080
      }
    },
    receipts: { device_phone: h("8") }
  }
};

const EXPECTED = {
  message:
    '{"attachments":[{"id":"attachment_1","kind":"text","mediaType":"text/markdown","name":"设定.md","size":120}],"compactions":[{"createdAt":"2026-10-12T07:59:00.000Z","id":"compaction_1","summary":"前文摘要"}],"content":"第一章写好了。","createdAt":"2026-10-12T08:00:01.000Z","id":"msg_1","kind":"deepwrite.conversation-message","model":{"configId":"model_writer-1","model":"writer-v1","provider":"custom"},"proposals":[{"additions":12,"deletions":0,"id":"proposal_1","status":"accepted","summary":"新增正文","title":"第一章"}],"role":"assistant","runId":"run_1","schemaVersion":1,"status":"completed","steps":[{"content":"先看大纲。","createdAt":"2026-10-12T08:00:00.000Z","id":"step_1","type":"thinking"},{"createdAt":"2026-10-12T08:00:00.500Z","id":"step_2","toolCallId":"call_1","type":"tool"},{"content":"第一章写好了。","createdAt":"2026-10-12T08:00:01.000Z","id":"step_3","type":"response"}],"subagents":[{"id":"sub_1","name":"审校","status":"completed","summary":"没有问题","task":"检查错字","toolCallId":"call_2"}],"thinking":"先看大纲。","tools":[{"id":"call_1","inputSummary":"大纲","name":"read_document","resultSummary":"已读取","status":"completed"}],"usage":{"cacheReadTokens":0,"cacheWriteTokens":0,"inputTokens":100,"outputTokens":20,"totalTokens":120}}',
  session:
    '{"createdAt":"2026-10-12T07:58:00.000Z","id":"session_1","kind":"deepwrite.conversation-session","messages":[{"at":"2026-10-12T08:00:02.000Z","bytes":180,"createdAt":"2026-10-12T08:00:00.000Z","id":"msg_0","parent":null,"record":{"hash":"1111111111111111111111111111111111111111111111111111111111111111","pack":"2222222222222222222222222222222222222222222222222222222222222222"}},{"at":"2026-10-12T08:00:02.000Z","bytes":900,"createdAt":"2026-10-12T08:00:01.000Z","id":"msg_1","parent":"msg_0","record":{"hash":"3333333333333333333333333333333333333333333333333333333333333333","pack":"2222222222222222222222222222222222222222222222222222222222222222"}}],"removed":[{"at":"2026-10-12T08:10:00.000Z","id":"msg_x"}],"schemaVersion":1,"state":{"at":"2026-10-12T07:58:00.000Z","deleted":false}}',
  book: '{"key":"book:book-a1b2c3d4","kind":"deepwrite.conversation-book","schemaVersion":1,"sessions":{"session_1":{"bytes":1080,"deleted":false,"messages":2,"ref":{"hash":"4444444444444444444444444444444444444444444444444444444444444444","pack":"5555555555555555555555555555555555555555555555555555555555555555"}}}}',
  commit:
    '{"books":{"book:book-a1b2c3d4":{"bytes":1080,"ref":{"hash":"6666666666666666666666666666666666666666666666666666666666666666","pack":"7777777777777777777777777777777777777777777777777777777777777777"},"sessions":1}},"createdAt":"2026-10-12T08:11:00.000Z","deviceId":"device_pc","deviceName":"电脑","kind":"deepwrite.conversation-commit","receipts":{"device_phone":"8888888888888888888888888888888888888888888888888888888888888888"},"schemaVersion":1,"sequence":3,"spaceId":"space_1"}'
};

describe("conversation exchange format", () => {
  it("serializes every record kind to the bytes the phone expects", () => {
    expect(
      stableSyncJson(conversationSyncMessageSchema.parse(SAMPLES.message))
    ).toBe(EXPECTED.message);
    expect(
      stableSyncJson(conversationSyncSessionSchema.parse(SAMPLES.session))
    ).toBe(EXPECTED.session);
    expect(stableSyncJson(conversationSyncBookSchema.parse(SAMPLES.book))).toBe(
      EXPECTED.book
    );
    expect(
      stableSyncJson(conversationSyncCommitSchema.parse(SAMPLES.commit))
    ).toBe(EXPECTED.commit);
  });

  it("rejects fields and kinds it does not know", () => {
    expect(
      conversationSyncMessageSchema.safeParse({ ...SAMPLES.message, draft: "" })
        .success
    ).toBe(false);
    expect(
      conversationSyncMessageSchema.safeParse({
        ...SAMPLES.message,
        schemaVersion: 2
      }).success
    ).toBe(false);
    expect(
      conversationSyncBookSchema.safeParse({
        ...SAMPLES.book,
        key: "material-library:lib-1"
      }).success
    ).toBe(false);
    expect(
      conversationSyncSessionSchema.safeParse({
        ...SAMPLES.session,
        removed: [{ id: "msg_0", at: "2026-10-12T08:10:00.000Z" }]
      }).success
    ).toBe(false);
  });
});
