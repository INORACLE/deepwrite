import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, it, expect } from "vitest";
import LongProposalReview from "./LongProposalReview.vue";
import {
  continuityWriteEvent,
  harness
} from "../composables/useLongWorkspaceProposals.test-support";

describe("long proposal failure feedback", () => {
  it("distinguishes a save failure from unvalidated file identity", async () => {
    const test = harness();
    const event = continuityWriteEvent();
    await test.controller.handleEvent(event);
    test.applyOperations.mockRejectedValueOnce({
      code: "catalog.command_failed",
      message: "Test storage error"
    });
    await test.controller.approve("longbook_test", event.id);
    const item = test.controller.itemsForBook("longbook_test")[0]!;
    const html = await renderToString(
      createSSRApp({ render: () => h(LongProposalReview, { items: [item] }) })
    );
    expect(html).toContain("Test storage error");
    expect(html).toContain("重新读取并校验文件后可查看差异");
    expect(html).not.toContain("文件身份和原文尚未通过校验");
    const waiting = {
      ...item,
      status: "waiting" as const,
      blockedByError: true
    };
    const blocked = await renderToString(
      createSSRApp({
        render: () => h(LongProposalReview, { items: [waiting] })
      })
    );
    expect(blocked).toContain("前序处理失败");
    expect(blocked).toContain("请先重试或拒绝该提案");
  });
});
