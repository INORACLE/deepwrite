import {
  continuityWriteEvent,
  textFilesLedgerEvent,
  harness,
  describe,
  it,
  expect,
  vi
} from "./useLongWorkspaceProposals.test-support";

function laterEvent() {
  const event = continuityWriteEvent();
  if (event.type !== "long.continuity_file_proposal")
    throw new Error("Invalid fixture");
  return {
    ...event,
    id: "event_later",
    timestamp: "2099-01-01T00:00:00.000Z",
    payload: { ...event.payload, toolCallId: "tool_later" }
  };
}

describe("long proposal failure recovery", () => {
  it("shows the actual save error and identifies blocked proposals until recovery", async () => {
    const test = harness();
    const first = continuityWriteEvent();
    const later = laterEvent();
    await test.controller.handleEvent(first);
    await test.controller.handleEvent(later);
    test.applyOperations.mockRejectedValueOnce({
      code: "catalog.command_failed",
      message: "EACCES: test directory is not writable"
    });
    await test.controller.approve("longbook_test", first.id);
    const items = () => test.controller.itemsForBook("longbook_test");
    expect(items().find((item) => item.event.id === first.id)).toMatchObject({
      status: "error",
      errorPhase: "apply",
      error: "处理长篇提案失败。 EACCES: test directory is not writable"
    });
    expect(items().find((item) => item.event.id === later.id)).toMatchObject({
      status: "waiting",
      blockedByError: true
    });
    await test.controller.approve("longbook_test", first.id);
    expect(items().find((item) => item.event.id === first.id)?.status).toBe(
      "ready"
    );
    expect(
      items().find((item) => item.event.id === later.id)?.blockedByError
    ).toBe(false);
    await test.controller.approve("longbook_test", first.id);
    expect(items().find((item) => item.event.id === later.id)?.status).toBe(
      "ready"
    );
  });

  it("does not skip a failed predecessor when later automatic proposals arrive", async () => {
    const test = harness(true, "auto-approve");
    const first = continuityWriteEvent();
    const later = laterEvent();
    test.applyOperations.mockRejectedValueOnce({
      code: "catalog.command_failed",
      message: "Temporary storage failure"
    });
    await test.controller.handleEvent(first);
    await test.controller.handleEvent(later);
    expect(test.applyOperations).toHaveBeenCalledTimes(1);
    expect(
      test.controller
        .itemsForBook("longbook_test")
        .find((item) => item.event.id === later.id)
    ).toMatchObject({ status: "waiting", blockedByError: true });
    await test.controller.retryPreview("longbook_test", first.id);
    await vi.waitFor(() =>
      expect(
        test.controller
          .itemsForBook("longbook_test")
          .every((item) => item.status === "accepted")
      ).toBe(true)
    );
    expect(test.applyOperations).toHaveBeenCalledTimes(3);
  });

  it("keeps historical read-only failures non-retryable and releases followers on rejection", async () => {
    const test = harness();
    const first = continuityWriteEvent();
    test.previewOperations.mockRejectedValueOnce({
      code: "long.operation.historical_continuity_readonly",
      message: "Historical checkpoint"
    });
    await test.controller.handleEvent(first);
    await test.controller.handleEvent(laterEvent());
    await test.controller.handleEvent(textFilesLedgerEvent());
    expect(
      test.controller
        .itemsForBook("longbook_test")
        .find((item) => item.event.type === "long.ledger_commit_proposal")
    ).toMatchObject({ status: "waiting", blockedByError: true });
    expect(
      test.controller
        .itemsForBook("longbook_test")
        .find((item) => item.event.id === first.id)
    ).toMatchObject({
      status: "error",
      errorRetryable: false,
      error: "历史章节的连续性文件为只读，仅最新账本提交的末章可以继续修改。"
    });
    expect(test.commitChapter).not.toHaveBeenCalled();
    expect(test.controller.reject("longbook_test", first.id)).toBe(true);
    await vi.waitFor(() =>
      expect(
        test.controller
          .itemsForBook("longbook_test")
          .find((item) => item.event.id === "event_later")?.status
      ).toBe("ready")
    );
    expect(test.commitChapter).not.toHaveBeenCalled();
  });
});
