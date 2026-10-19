import { afterEach, describe, expect, it } from "vitest";
import {
  decompositionUsageLimit,
  readyDecompositionUnitIds
} from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

const roots: string[] = [];
afterEach(() => cleanupDecompositionRoots(roots));

const usage = (tokens: number) => ({
  inputTokens: tokens,
  cacheReadTokens: 0,
  outputTokens: 0,
  requests: 1
});

describe("decomposition usage guard", () => {
  it("keeps Main-observed usage across control calls", async () => {
    const { job, root, service } = await decompositionFixture("materials", 3);
    roots.push(root);
    await service.control({ jobId: job.id, action: "stop" }, usage(1000));
    const saved = await service.control(
      { jobId: job.id, action: "stop" },
      { ...usage(500), cacheReadTokens: 2000 }
    );
    expect(saved?.usage).toEqual({
      inputTokens: 1500,
      cacheReadTokens: 2000,
      outputTokens: 0,
      requests: 2
    });
  });

  it("pauses after a package past the limit and raises it on continue", async () => {
    const { job, root, service } = await decompositionFixture("materials", 3);
    roots.push(root);
    const [unitId] = readyDecompositionUnitIds(job);
    const opened = await service.open(
      { jobId: job.id, phase: "read", unitIds: [unitId!] },
      job.profile.id,
      "ldattempt_usage"
    );
    const limit = decompositionUsageLimit(opened.job);
    const paused = await service.control(
      {
        jobId: job.id,
        action: "finish-package",
        attemptId: "ldattempt_usage"
      },
      usage(limit + 1)
    );
    expect(paused?.status).toBe("stopped");
    expect(paused?.lastError).toContain("任务已暂停");
    const resumed = await service.control({ jobId: job.id, action: "resume" });
    expect(resumed?.status).toBe("idle");
    expect(resumed?.lastError).toBeUndefined();
    expect(resumed?.usageLimitTokens).toBe(Math.ceil((limit + 1) * 1.5));
  });
});
