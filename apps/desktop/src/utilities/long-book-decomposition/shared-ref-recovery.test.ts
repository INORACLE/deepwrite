import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import type { DecompositionSubmissionData } from "@deepwrite/contracts";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { readSecureTextFile } from "../long-project-store/io";
import { finalizeDecomposition } from "./completion-service";
import { DecompositionService } from "./service";
import { markDecompositionUnitDone } from "./submission-staging";
import { decompositionFixture } from "./test-support";
import { addDecompositionUnit } from "./workflow";

const roots: string[] = [];
vi.setConfig({ testTimeout: 30_000 });
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function sharedArcFixture() {
  const f = await decompositionFixture("continuation", 3);
  roots.push(f.root);
  const { service, job } = f;
  job.units = {};
  job.phase = "review";
  for (const id of ["chronicle:1", "chronicle:2"])
    addDecompositionUnit(job, id, "integrate");
  const save = async (unitId: string, data: DecompositionSubmissionData) => {
    const receipt = await service.write(job, unitId, data);
    markDecompositionUnitDone(job, unitId, receipt);
    await service.state.save(job);
    return receipt;
  };
  const chronicle = (order: number, summary = "剧情经过。") =>
    ({
      kind: "asset",
      asset: {
        kind: "chronicle",
        summary,
        points: [
          {
            title: `第 ${order} 章剧情`,
            summary,
            startOrder: order,
            endOrder: order
          }
        ]
      }
    }) satisfies DecompositionSubmissionData;
  // The later chapter saves first; inserting an earlier arc then renumbers it.
  const first = await save("chronicle:1", chronicle(3));
  const second = await save("chronicle:2", chronicle(1));
  const shared = first.refs.find((ref) =>
    second.refs.some(
      (next) => next.resourceId === ref.resourceId && next.sha256 !== ref.sha256
    )
  )!;
  expect(shared).toBeDefined();
  const latest = second.refs.find(
    (ref) => ref.resourceId === shared.resourceId
  )!;
  // Review changes the input revision. The old receipt must no longer prove
  // completion, but its already-committed shared-resource update still matters.
  const repair = job.units["chronicle:2"]!;
  repair.inputRevision += ":review:repair";
  repair.phase = "review";
  repair.status = "writing";
  job.status = "running";
  await service.state.save(job);
  const restart = () =>
    new DecompositionService(
      f.root,
      new LongWorkspaceService({ userDataPath: f.userDataPath }),
      new FolderCatalogStore({ userDataPath: f.userDataPath })
    );
  return { ...f, save, chronicle, shared, latest, restart };
}

it("审校重写中断后保留历史回执的共享对象版本，但不把旧输入当成完成", async () => {
  const f = await sharedArcFixture();
  f.job.units["chronicle:1"]!.status = "conflict";
  f.job.units["chronicle:1"]!.lastError = "decomposition.conflict: 旧版本误报";
  await f.service.state.save(f.job);
  const service = f.restart();
  const resumed = (await service.control({
    jobId: f.job.id,
    action: "resume"
  }))!;
  expect(resumed.units["chronicle:1"]!.status).toBe("done");
  expect(resumed.units["chronicle:1"]).not.toHaveProperty("lastError");
  expect(resumed.units["chronicle:1"]!.outputRefs).toContainEqual(f.latest);
  expect(resumed.units["chronicle:2"]!.status).toBe("pending");
  expect(await service.reader.receipts(resumed)).toHaveLength(1);
});

it("重写不再改动共享对象时，重启和最终校验仍采用历史最新版本", async () => {
  const f = await sharedArcFixture();
  const repaired = await f.save(
    "chronicle:2",
    f.chronicle(1, "审校后的经过。")
  );
  expect(
    repaired.refs.some((ref) => ref.resourceId === f.shared.resourceId)
  ).toBe(false);
  addDecompositionUnit(f.job, "continuity:latest", "review");
  await f.save("continuity:latest", {
    kind: "asset",
    asset: {
      kind: "continuity",
      characterState: "人物状态未变。",
      handoff: "继续寻找铜铃。",
      foreshadowingChanges: "没有新伏笔。"
    }
  });
  addDecompositionUnit(f.job, "summary:characters", "finalize");
  await f.save("summary:characters", {
    kind: "asset",
    asset: {
      kind: "topic",
      domain: "character",
      title: "人物概览",
      content: "无人物。"
    }
  });
  const service = f.restart();
  const job = await service.state.load(f.job.id);
  expect(job.units["chronicle:1"]!.outputRefs).toContainEqual(f.shared);
  const checked = await service.recover(structuredClone(job), true);
  expect(
    Object.values(checked.units).every(({ status }) => status === "done")
  ).toBe(true);
  expect(checked.units["chronicle:1"]!.outputRefs).toContainEqual(f.latest);
  // Finalization must also work without a preceding recovery of this snapshot.
  await finalizeDecomposition(
    job,
    service.state,
    service.longs,
    service.catalog,
    service.reader
  );
  expect(job.status).toBe("completed");
  const recovered = await f
    .restart()
    .recover(await service.state.load(job.id), true);
  expect(
    Object.values(recovered.units).every(({ status }) => status === "done")
  ).toBe(true);
}, 30_000);

it.each(["jobId", "outputVersion"] as const)(
  "不采纳其他任务或输出版本的历史回执：%s",
  async (field) => {
    const f = await sharedArcFixture();
    const oldReceiptId = f.job.units["chronicle:2"]!.receiptIds[0]!;
    await f.save("chronicle:2", f.chronicle(1, "审校后的经过。"));
    if (f.job.target?.kind !== "long") throw new Error("长篇目标未绑定。");
    const { projectDirectory } = await f.longs.catalog.open(
      f.job.target.bookId
    );
    await f.longs.store.transactManaged(projectDirectory, async (loaded) => {
      const file = loaded.index.writeReceipts!.find(
        ({ id }) => id === oldReceiptId
      )!;
      const disk = await readSecureTextFile(
        projectDirectory,
        file.path,
        4 * 1024 * 1024
      );
      const receipt = JSON.parse(disk.content);
      if (field === "jobId") receipt.jobId = "ldjob_unrelated";
      else receipt.outputVersion++;
      return {
        operations: [
          {
            path: file.path,
            content: JSON.stringify(receipt),
            expectedSha256: disk.sha256
          }
        ],
        result: undefined
      };
    });
    const service = f.restart();
    const recovered = await service.recover(
      await service.state.load(f.job.id),
      true
    );
    expect(recovered.units["chronicle:1"]!.status).toBe("conflict");
  }
);

it("历史回执不能掩盖用户对共享剧情段的真实修改", async () => {
  const f = await sharedArcFixture();
  await f.save("chronicle:2", f.chronicle(1, "审校后的经过。"));
  if (f.job.target?.kind !== "long") throw new Error("长篇目标未绑定。");
  const { projectDirectory } = await f.longs.catalog.open(f.job.target.bookId);
  await f.longs.store.transactManaged(projectDirectory, async (loaded) => {
    const arc = loaded.index.plot.arcs.find(
      ({ id }) => id === f.shared.resourceId
    )!;
    arc.summary = "用户补充的剧情。";
    return {
      operations: [
        { path: "user-note.md", content: "用户笔记", expectedSha256: null }
      ],
      result: undefined
    };
  });
  const service = f.restart();
  const recovered = await service.recover(
    await service.state.load(f.job.id),
    true
  );
  expect(recovered.units["chronicle:1"]!.status).toBe("conflict");
  expect(recovered.units["chronicle:1"]!.lastError).toContain(
    "decomposition.conflict"
  );
  expect(await service.reader.currentHash(recovered, f.latest)).not.toBe(
    f.latest.sha256
  );
});
