import { describe, expect, it } from "vitest";
import {
  desktopMessageRecord,
  desktopMessageValue,
  desktopRemote
} from "./desktop-records";

const assistant = {
  id: "msg_1",
  role: "assistant",
  content: "第一章写好了。",
  createdAt: "2026-10-12T08:00:01.000Z",
  status: "completed",
  runId: "run_1",
  thinking: "先看大纲。",
  runtime: {
    provider: "custom",
    model: "writer-v1",
    mode: "provider",
    configId: "model_writer-1"
  },
  processingSteps: [
    {
      id: "step_1",
      type: "thinking",
      content: "先看大纲。",
      createdAt: "2026-10-12T08:00:00.000Z"
    },
    { id: "broken", type: "tool", createdAt: "2026-10-12T08:00:00.000Z" }
  ],
  toolCalls: [
    {
      id: "call_1",
      name: "read_document",
      args: { title: "大纲" },
      status: "completed",
      requestedAt: "2026-10-12T08:00:00.000Z",
      resultSummary: "已读取"
    },
    { id: 7, name: "invalid" }
  ],
  editProposals: [
    {
      id: "proposal_1",
      title: "第一章",
      summary: "新增正文",
      status: "accepting",
      additions: 12,
      deletions: 1,
      hunks: [{ lines: [] }],
      proposedText: "完整正文不进入同步"
    }
  ],
  evaluationSnapshot: { tools: [] },
  draft: "不属于消息"
};

describe("desktop conversation records", () => {
  it("keeps what another device can show and drops device-only state", () => {
    const record = desktopMessageRecord(assistant);
    expect(record).toMatchObject({
      id: "msg_1",
      status: "completed",
      model: { configId: "model_writer-1", provider: "custom" },
      steps: [{ id: "step_1", type: "thinking" }],
      tools: [
        {
          id: "call_1",
          name: "read_document",
          inputSummary: '{"title":"大纲"}',
          resultSummary: "已读取"
        }
      ],
      proposals: [
        {
          id: "proposal_1",
          status: "pending",
          additions: 12,
          deletions: 1
        }
      ]
    });
    expect(JSON.stringify(record)).not.toContain("完整正文不进入同步");
    expect(JSON.stringify(record)).not.toContain("evaluationSnapshot");
  });

  it("keeps unfinished messages local", () => {
    expect(desktopMessageRecord({ ...assistant, status: "streaming" })).toBe(
      null
    );
    expect(desktopMessageRecord({ ...assistant, createdAt: "later" })).toBe(
      null
    );
  });

  it("stores a received record with its origin and read-only details", () => {
    const record = desktopMessageRecord(assistant)!;
    const value = desktopMessageValue(record, "a".repeat(64), "手机");
    expect(desktopRemote(value)).toMatchObject({
      recordHash: "a".repeat(64),
      device: "手机",
      proposals: [{ id: "proposal_1", status: "pending" }]
    });
    expect(value).toMatchObject({
      status: "completed",
      runtime: { provider: "custom", model: "writer-v1", mode: "provider" },
      toolCalls: [{ id: "call_1", status: "completed" }]
    });
    expect(value).not.toHaveProperty("editProposals");
    // Converting it again keeps the proposals the original device made.
    expect(desktopMessageRecord(value)?.proposals).toEqual(record.proposals);
  });
});
