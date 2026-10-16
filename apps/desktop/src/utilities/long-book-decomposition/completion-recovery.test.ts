import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { DecompositionService } from "./service";
import { decompositionFixture } from "./test-support";
import { runDecompositionFaux } from "./faux-run.test-support";
import * as longUnitWriter from "./long-unit-writer";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it.each(["before-receipt", "after-receipt"] as const)(
  "人物概览在 %s 中断后，继续只恢复本地收尾并完成账本",
  async (interruption) => {
    const f = await decompositionFixture("continuation", 1);
    roots.push(f.root);
    const write = longUnitWriter.writeDecompositionLongUnit;
    const interrupted = vi
      .spyOn(longUnitWriter, "writeDecompositionLongUnit")
      .mockImplementation(async (...args) => {
        if (args[2] === "summary:characters") {
          if (interruption === "after-receipt") await write(...args);
          throw new Error("模拟人物概览写入中断");
        }
        return write(...args);
      });
    await expect(runDecompositionFaux(f)).rejects.toThrow("人物概览写入中断");
    interrupted.mockRestore();
    const saved = await f.service.state.load(f.job.id);
    expect(saved).toMatchObject({ phase: "finalize", status: "failed" });
    expect(saved.units["summary:characters"]?.status).toBe("pending");
    const completed = Object.fromEntries(
      Object.entries(saved.units).filter(([, unit]) => unit.status === "done")
    );
    expect(Object.keys(completed).length).toBeGreaterThan(0);
    const restarted = new DecompositionService(
      f.root,
      new LongWorkspaceService({ userDataPath: f.userDataPath }),
      new FolderCatalogStore({ userDataPath: f.userDataPath })
    );
    const resumed = await restarted.control({
      jobId: saved.id,
      action: "resume"
    });
    expect(resumed?.phase).toBe("finalize");
    const completedJob = await restarted.control({
      jobId: saved.id,
      action: "advance"
    });
    expect(completedJob).toMatchObject({ phase: "done", status: "completed" });
    expect(completedJob?.units["summary:characters"]?.status).toBe("done");
    for (const [id, unit] of Object.entries(completed))
      expect(completedJob?.units[id]).toMatchObject({
        status: "done",
        attempts: unit.attempts,
        inputRevision: unit.inputRevision,
        receiptIds: unit.receiptIds
      });
    expect((await restarted.state.completion(saved.id)).finalized).toBe(true);
    if (saved.target?.kind !== "long") throw new Error("长篇目标未绑定。");
    expect(
      (await restarted.longs.catalog.open(saved.target.bookId)).book
        .workspaceIndex.ledger.commits
    ).toHaveLength(1);
  },
  60_000
);

it("账本已提交、回执未刷新时，兼容超过 1 MB 的旧日志并继续收尾，不重复拆书或提交账本", async () => {
  const f = await decompositionFixture(
    "continuation",
    1,
    () => "主角继续寻找铜铃。伏笔1埋设。"
  );
  roots.push(f.root);
  const commit = f.longs.store.commitChapter.bind(f.longs.store);
  const interrupted = vi
    .spyOn(f.longs.store, "commitChapter")
    .mockImplementation(async (...args) => {
      await commit(...args);
      throw new Error("模拟账本提交后中断");
    });
  await expect(runDecompositionFaux(f)).rejects.toThrow("账本提交后中断");
  interrupted.mockRestore();
  const saved = await f.service.state.load(f.job.id);
  expect(saved.phase).toBe("finalize");
  expect(
    Object.values(saved.units).every(({ status }) => status === "done")
  ).toBe(true);
  if (saved.target?.kind !== "long") throw new Error("长篇目标未绑定。");
  const completion = await f.service.state.completion(saved.id);
  // Old versions copied every unit's refs, including those unchanged by the ledger.
  const legacy = {
    ...completion,
    postCommitRefs: Object.fromEntries(
      Object.entries(saved.units)
        .filter(([, unit]) => unit.outputRefs.length)
        .map(([id, unit]) => [
          id,
          completion.postCommitRefs?.[id] ?? unit.outputRefs
        ])
    )
  };
  const path = join(f.service.state.directory(saved.id), "completion.json");
  await writeFile(
    path,
    JSON.stringify(legacy) + "\n" + " ".repeat(1024 * 1024)
  );
  expect(Buffer.byteLength(await readFile(path))).toBeGreaterThan(1024 * 1024);
  const restarted = new DecompositionService(
    f.root,
    new LongWorkspaceService({ userDataPath: f.userDataPath }),
    new FolderCatalogStore({ userDataPath: f.userDataPath })
  );
  const resumed = await restarted.control({
    jobId: saved.id,
    action: "resume"
  });
  expect(resumed).not.toBeNull();
  expect(
    Object.values(resumed!.units).every(({ status }) => status === "done")
  ).toBe(true);
  const completed = await restarted.control({
    jobId: saved.id,
    action: "advance"
  });
  expect(completed).toMatchObject({ phase: "done", status: "completed" });
  expect((await restarted.state.completion(saved.id)).finalized).toBe(true);
  expect(
    (await restarted.longs.catalog.open(saved.target.bookId)).book
      .workspaceIndex.ledger.commits
  ).toHaveLength(1);
  const recovered = await restarted.recover(
    await restarted.state.load(saved.id),
    true
  );
  expect(
    Object.values(recovered.units).every(({ status }) => status === "done")
  ).toBe(true);
}, 60_000);
