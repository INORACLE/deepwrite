import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { readyDecompositionUnitIds } from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";
import { runDecompositionFaux } from "./faux-run.test-support";
import { DecompositionService } from "./service";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it.each(["continuation", "materials"] as const)(
  "额度耗尽暂停 %s 的工作包，重启后继续保留已保存的章节与回执",
  async (mode) => {
    const f = await decompositionFixture(mode, 3);
    roots.push(f.root);
    const opened = await f.service.open(
      { jobId: f.job.id, phase: "read", unitIds: ["chunk:1"] },
      f.job.profile.id,
      "ldattempt_quota"
    );
    const checkpoint = "reading:source_chapter_1";
    const chapter = f.source.chapters[0]!;
    const receipt = await f.service.submit({
      jobId: f.job.id,
      outputVersion: f.job.outputVersion,
      attemptId: opened.input.attemptId,
      unitId: checkpoint,
      inputRevision: opened.job.units[checkpoint]!.inputRevision,
      data: {
        kind: "reading",
        card: {
          chunkId: "chunk:1",
          chapters: [
            {
              chapterId: chapter.id,
              order: 1,
              title: chapter.title,
              summary: "主角寻找铜铃。",
              events: [],
              characters: []
            }
          ],
          characters: [],
          world: [],
          plot: { events: [], foreshadowing: [] },
          style: { notes: [], excerpts: [] }
        }
      }
    });
    const before = await f.service.state.load(f.job.id);
    const paused = await f.service.control({
      jobId: f.job.id,
      action: "finish-package",
      attemptId: opened.input.attemptId,
      failed: true,
      error: "429 insufficient_quota"
    });
    expect(paused).toMatchObject({
      status: "stopped",
      lastError: "429 insufficient_quota"
    });
    expect(paused).not.toHaveProperty("activeAttemptId");
    expect(paused?.units[checkpoint]).toEqual(before.units[checkpoint]);
    for (const id of [
      "chunk:1",
      "reading:source_chapter_2",
      "reading:source_chapter_3"
    ])
      expect(paused?.units[id]).toMatchObject({
        status: "pending",
        attempts: 0
      });
    const restarted = new DecompositionService(f.root, f.longs, f.catalog);
    const resumed = (await restarted.control({
      jobId: f.job.id,
      action: "resume"
    }))!;
    expect(resumed).toMatchObject({
      id: f.job.id,
      phase: "read",
      status: "idle"
    });
    expect(resumed).not.toHaveProperty("lastError");
    expect(resumed.units[checkpoint]).toEqual(before.units[checkpoint]);
    expect(readyDecompositionUnitIds(resumed)).toEqual(["chunk:1"]);
    const done = await runDecompositionFaux({
      ...f,
      service: restarted,
      job: resumed
    });
    expect(done.status).toBe("completed");
    expect(done.units[checkpoint]).toEqual(before.units[checkpoint]);
    expect(
      (await restarted.reader.receipts(done)).filter(
        ({ id }) => id === receipt.id
      )
    ).toHaveLength(1);
  },
  60_000
);

it("提前停止不需要读取真实长篇，仍保存额度错误、用量并释放运行单元", async () => {
  const f = await decompositionFixture("continuation", 1);
  roots.push(f.root);
  await f.service.open(
    { jobId: f.job.id, phase: "read", unitIds: ["chunk:1"] },
    f.job.profile.id,
    "ldattempt_child_quota"
  );
  const paused = await f.service.control(
    {
      jobId: f.job.id,
      action: "stop",
      error: "用户额度已用尽"
    },
    { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 0, requests: 1 }
  );
  expect(paused).toMatchObject({
    status: "stopped",
    lastError: "用户额度已用尽",
    usage: { requests: 1, inputTokens: 1000 }
  });
  expect(paused).not.toHaveProperty("activeAttemptId");
  for (const unit of Object.values(paused!.units)) {
    expect(unit).toMatchObject({ status: "pending", attempts: 0 });
    expect(unit).not.toHaveProperty("attemptId");
  }
  expect(await f.service.state.load(f.job.id)).toEqual(paused);
});
