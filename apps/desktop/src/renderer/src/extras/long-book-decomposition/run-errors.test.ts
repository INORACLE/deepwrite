import { expect, it, vi } from "vitest";
import {
  decompositionEngineFixture as fixture,
  model
} from "./engine.test-support";
import { useLongBookDecomposition } from "./useLongBookDecomposition";

it("额度错误后检查任务失败，也保留模型错误和可继续状态", async () => {
  const f = fixture();
  const controller = useLongBookDecomposition({ api: () => f.api });
  controller.setConfiguredModels([model]);
  controller.job.value = structuredClone(f.stored());
  f.extras.run.mockRejectedValue({
    code: "insufficient_quota",
    message: "模型额度已耗尽"
  });
  f.getJob.mockRejectedValue({
    code: "decomposition.command_failed",
    message: "真实长篇文档在读取期间发生变化。"
  });
  try {
    await controller.run();
    expect(controller.isBusy.value).toBe(false);
    expect(controller.job.value?.status).toBe("stopped");
    expect(controller.error.value).toContain("模型额度已耗尽");
    expect(controller.error.value).not.toContain("读取期间发生变化");
    expect(f.extras.run).toHaveBeenCalledTimes(1);
  } finally {
    controller.dispose();
    f.engine.dispose();
    vi.restoreAllMocks();
  }
});
