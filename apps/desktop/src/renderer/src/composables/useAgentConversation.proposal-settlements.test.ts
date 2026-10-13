import {
  createDeferredApi,
  createEditProposal,
  describe,
  document,
  expect,
  it,
  useAgentConversation
} from "./useAgentConversation.test-support";

describe("agent conversation controller: proposal settlements", () => {
  it("reports the previous turn's proposal outcomes with the next prompt", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.messages.value = [
      {
        id: "user_1",
        role: "user",
        content: "修改剧情",
        createdAt: "2026-10-12T01:00:00.000Z",
        status: "completed"
      },
      {
        id: "run_edit_1_assistant",
        role: "assistant",
        content: "已提交剧情修改",
        createdAt: "2026-10-12T01:00:01.000Z",
        runId: "run_edit_1",
        status: "completed"
      }
    ];
    controller.upsertEditProposal("run_edit_1", createEditProposal());
    controller.updateEditProposal("run_edit_1", "proposal_1", {
      status: "accepted",
      statusMessage: "已应用"
    });

    controller.draft.value = "继续";
    void controller.sendMessage(document);
    expect(deferred.prompts[0]?.proposalSettlements).toEqual({
      items: [
        {
          title: "剧情设计",
          summary: "调整雨夜相遇的因果关系",
          status: "saved"
        }
      ]
    });
    controller.dispose();
  });

  it("does not repeat outcomes that settled before the previous prompt", () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controller.messages.value = [
      {
        id: "run_edit_1_assistant",
        role: "assistant",
        content: "已提交剧情修改",
        createdAt: "2026-10-12T01:00:01.000Z",
        runId: "run_edit_1",
        status: "completed"
      }
    ];
    controller.upsertEditProposal("run_edit_1", createEditProposal());
    controller.updateEditProposal("run_edit_1", "proposal_1", {
      status: "rejected"
    });
    controller.messages.value.push({
      id: "user_2",
      role: "user",
      content: "换个方向",
      createdAt: new Date(Date.now() + 60_000).toISOString(),
      status: "completed"
    });

    controller.draft.value = "继续";
    void controller.sendMessage(document);
    expect(deferred.prompts[0]).not.toHaveProperty("proposalSettlements");
    controller.dispose();
  });
});
