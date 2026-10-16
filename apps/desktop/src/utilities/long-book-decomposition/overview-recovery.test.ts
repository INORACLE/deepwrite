import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { DecompositionSubmissionDataSchema } from "@deepwrite/contracts";
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

it("汇总超过 20 万字的人物概览，中断后继续仍保留全文且只提交一次账本", async () => {
  const f = await decompositionFixture(
    "continuation",
    1,
    () => "主角与人物1、人物2寻找铜铃。"
  );
  roots.push(f.root);
  const write = f.service.write.bind(f.service);
  vi.spyOn(f.service, "write").mockImplementation(async (job, unitId, data) => {
    if (data.kind === "asset" && data.asset.kind === "character")
      data = DecompositionSubmissionDataSchema.parse({
        ...data,
        asset: {
          ...data.asset,
          summary: `${data.asset.registryId}\n${'人物摘要😀\n"'.repeat(12_000)}`
        }
      });
    return write(job, unitId, data);
  });
  const writeLong = longUnitWriter.writeDecompositionLongUnit;
  const interrupted = vi
    .spyOn(longUnitWriter, "writeDecompositionLongUnit")
    .mockImplementation(async (...args) => {
      if (args[2] === "summary:characters")
        throw new Error("模拟概览记录已保存后中断");
      return writeLong(...args);
    });
  await expect(runDecompositionFaux(f)).rejects.toThrow("概览记录已保存后中断");
  interrupted.mockRestore();
  const saved = await f.service.state.load(f.job.id);
  expect(saved).toMatchObject({ phase: "finalize", status: "failed" });
  expect(saved.units["summary:characters"]?.status).toBe("pending");
  const overview = await f.service.records.record(saved, "summary:characters");
  if (overview.data.kind !== "asset" || overview.data.asset.kind !== "topic")
    throw new Error("人物概览记录缺失。");
  const content = overview.data.asset.content;
  expect(content.length).toBeGreaterThan(200_000);
  const completed = Object.fromEntries(
    Object.entries(saved.units).filter(([, unit]) => unit.status === "done")
  );
  const restarted = new DecompositionService(
    f.root,
    new LongWorkspaceService({ userDataPath: f.userDataPath }),
    new FolderCatalogStore({ userDataPath: f.userDataPath })
  );
  await restarted.control({ jobId: saved.id, action: "resume" });
  const result = await restarted.control({
    jobId: saved.id,
    action: "advance"
  });
  expect(result).toMatchObject({ phase: "done", status: "completed" });
  if (!result || result.target?.kind !== "long")
    throw new Error("长篇目标未绑定。");
  const unit = result.units["summary:characters"]!;
  expect(unit.status).toBe("done");
  expect(await restarted.reader.content(unit.outputRefs[0]!)).toBe(content);
  expect(await restarted.reader.record(result, "summary:characters")).toEqual(
    overview
  );
  const characterIds = Object.keys(completed).filter((id) =>
    id.startsWith("character:")
  );
  expect(characterIds).toHaveLength(3);
  for (const id of characterIds) {
    const record = await restarted.reader.record(result, id);
    if (record.data.kind !== "asset" || record.data.asset.kind !== "character")
      throw new Error("人物档案缺失。");
    expect(content).toContain(record.data.asset.summary);
  }
  for (const [id, previous] of Object.entries(completed))
    expect(result.units[id]).toMatchObject({
      status: "done",
      attempts: previous.attempts,
      inputRevision: previous.inputRevision,
      receiptIds: previous.receiptIds
    });
  expect(
    (await restarted.longs.catalog.open(result.target.bookId)).book
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
