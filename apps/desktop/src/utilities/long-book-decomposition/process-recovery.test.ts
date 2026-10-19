import { fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { build } from "vite";
import type {
  DecompositionSubmitInput,
  DecompositionSourceConfirmation
} from "@deepwrite/contracts";
import { LongWorkspaceService } from "../long-workspace-service";
import { FolderCatalogStore } from "../folder-catalog-store";
import { DecompositionService } from "./service";
import { decompositionFixture } from "./test-support";
import { runDecompositionFaux } from "./faux-run.test-support";
import { addDecompositionUnit } from "./workflow";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

let workerDirectory: string;
const roots: string[] = [];
beforeAll(async () => {
  workerDirectory = await mkdtemp(
    join(tmpdir(), "deepwrite-decomposition-fault-worker-")
  );
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: join(
        dirname(fileURLToPath(import.meta.url)),
        "fault-worker.test-support.ts"
      ),
      outDir: workerDirectory,
      rollupOptions: { output: { entryFileNames: "worker.mjs" } }
    },
    ssr: { noExternal: true }
  });
}, 30_000);
afterEach(async () => {
  await cleanupDecompositionRoots(roots);
});
afterAll(async () => {
  await rm(workerDirectory, { recursive: true, force: true });
});

async function killAtCheckpoint(
  root: string,
  jobId: string,
  phase: string,
  input: unknown
) {
  const inputPath = join(root, "fault-input.json");
  await writeFile(inputPath, JSON.stringify(input));
  const child = fork(
    join(workerDirectory, "worker.mjs"),
    [root, jobId, phase, inputPath],
    { silent: true }
  );
  let diagnostics = "";
  child.stderr?.on("data", (data: Buffer) => {
    diagnostics = (diagnostics + data.toString()).slice(-2000);
  });
  return new Promise<DecompositionSourceConfirmation | undefined>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`故障检查点超时：${phase} ${diagnostics}`));
      }, 30_000);
      let reached = false;
      let confirmation: DecompositionSourceConfirmation | undefined;
      child.on("message", (message: unknown) => {
        const value = message as {
          checkpoint?: string;
          error?: string;
          confirmation?: DecompositionSourceConfirmation;
        };
        if (value.confirmation) confirmation = value.confirmation;
        if (value.error) {
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject(new Error(value.error));
        }
        if (value.checkpoint === phase) {
          reached = true;
          child.kill("SIGKILL");
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (_code, signal) => {
        clearTimeout(timer);
        if (reached && signal === "SIGKILL") resolve(confirmation);
        else reject(new Error(`故障进程提前退出：${diagnostics}`));
      });
    }
  );
}

it.each(["source-save", "source-confirm"])(
  "%s 后强杀 Core，重启保留校对与已保存确认，旧任务仍读取不可变版本",
  async (phase) => {
    const f = await decompositionFixture("materials", 1);
    roots.push(f.root);
    const confirmation = await killAtCheckpoint(f.root, f.job.id, phase, {});
    const current = await f.sources.load(f.source.id);
    expect(current.revision).toBe(2);
    expect(current.chapters[0]!.text).toBe("新版本自写正文");
    expect((await restart(f.root).source(f.job)).chapters[0]!.text).toBe(
      f.source.chapters[0]!.text
    );
    if (phase === "source-confirm")
      expect(
        await f.sources.readConfirmation(current.id, confirmation!.id)
      ).toEqual(confirmation);
    await expect(
      restart(f.root).create(
        {
          ...f.job,
          id: "ldjob_stale_after_kill",
          target: undefined,
          phase: "prepare_target",
          units: {}
        },
        {
          book: join(f.root, "books"),
          materials: join(f.root, "materials"),
          groups: join(f.root, "groups")
        }
      )
    ).rejects.toThrow("新版本");
  },
  60_000
);
function restart(root: string) {
  const userDataPath = join(root, "user-data");
  return new DecompositionService(
    root,
    new LongWorkspaceService({ userDataPath }),
    new FolderCatalogStore({ userDataPath })
  );
}
async function styleFixture() {
  const f = await decompositionFixture("materials", 1);
  roots.push(f.root);
  f.job.units = {};
  f.job.phase = "integrate";
  addDecompositionUnit(f.job, "style:profile", "integrate");
  await f.service.state.save(f.job);
  const opened = await f.service.open(
    { jobId: f.job.id, phase: "integrate", unitIds: ["style:profile"] },
    f.job.profile.id,
    "ldattempt_fault"
  );
  const input: DecompositionSubmitInput = {
    jobId: f.job.id,
    outputVersion: f.job.outputVersion,
    attemptId: opened.input.attemptId,
    unitId: "style:profile",
    inputRevision: opened.input.units["style:profile"]!.inputRevision,
    data: {
      kind: "asset",
      asset: {
        kind: "style",
        content: "短句推进。",
        excerpts: [
          {
            chapterOrder: 1,
            text: f.source.chapters[0]!.text,
            comment: "动作直接。"
          }
        ]
      }
    }
  };
  return { ...f, input };
}

it("目标建库后强杀 Core，重启补齐同一组五库且不重复创建", async () => {
  const f = await decompositionFixture("materials", 1);
  roots.push(f.root);
  const job = {
    ...f.job,
    id: "ldjob_fault_prepare",
    phase: "prepare_target" as const,
    status: "idle" as const,
    units: {}
  };
  delete job.target;
  await killAtCheckpoint(f.root, job.id, "prepare-target", job);
  const service = restart(f.root);
  const before = await service.catalog.indexSnapshot();
  expect(before.materials).toHaveLength(6);
  const resumed = (await service.control({ jobId: job.id, action: "resume" }))!;
  expect(resumed.target?.state).toBe("ready");
  expect((await service.catalog.indexSnapshot()).materials).toHaveLength(10);
  await service.control({ jobId: job.id, action: "resume" });
  expect((await service.catalog.indexSnapshot()).materials).toHaveLength(10);
}, 60_000);

it.each(["cross-library", "after-receipt"])(
  "%s 强杀 Core，真实回执恢复已写步骤并拒绝迟到尝试",
  async (phase) => {
    const f = await styleFixture();
    await killAtCheckpoint(f.root, f.job.id, phase, f.input);
    const service = restart(f.root);
    const restored = await service.recover(
      await service.state.load(f.job.id),
      true
    );
    expect(restored.units["style:profile"]!.status).toBe(
      phase === "cross-library" ? "pending" : "done"
    );
    if (phase === "cross-library") {
      await service.control({ jobId: f.job.id, action: "resume" });
      const opened = await service.open(
        { jobId: f.job.id, phase: "integrate", unitIds: ["style:profile"] },
        f.job.profile.id,
        "ldattempt_after_kill"
      );
      await expect(service.submit(f.input)).rejects.toThrow();
      await service.submit({ ...f.input, attemptId: opened.input.attemptId });
    }
    const done = await service.recover(
      await service.state.load(f.job.id),
      true
    );
    expect(done.units["style:profile"]!.status).toBe("done");
    expect(done.units["style:profile"]!.outputRefs).toHaveLength(2);
    expect(
      (await service.catalog.indexSnapshot()).materials.find(
        ({ materialKind }) => materialKind === "draft"
      )!.entries
    ).toHaveLength(2);
  },
  60_000
);

it("原生账本提交后强杀 Core，重启只补齐回执与收尾而不新增账本", async () => {
  const f = await decompositionFixture("continuation", 1);
  roots.push(f.root);
  const advance = f.service.advance.bind(f.service);
  const pause = vi
    .spyOn(f.service, "advance")
    .mockImplementation(async (job) => {
      if (
        job.phase === "review" &&
        Object.values(job.units)
          .filter((unit) => unit.phase === "review")
          .every(({ status }) => status === "done")
      ) {
        job.phase = "finalize";
        await f.service.state.save(job);
        throw new Error("账本前检查点");
      }
      return advance(job);
    });
  await expect(runDecompositionFaux(f)).rejects.toThrow("账本前检查点");
  pause.mockRestore();
  const fresh = await f.service.state.load(f.job.id);
  if (fresh.target?.kind !== "long") throw new Error("错误目标");
  expect(
    (await f.longs.catalog.open(fresh.target.bookId)).book.workspaceIndex.ledger
      .commits
  ).toHaveLength(0);
  await killAtCheckpoint(f.root, fresh.id, "ledger", {});
  const service = restart(f.root);
  const restored = await service.recover(
    await service.state.load(fresh.id),
    true
  );
  expect(
    Object.values(restored.units).every(({ status }) => status === "done")
  ).toBe(true);
  const finished = await service.advance(restored);
  expect(finished.status).toBe("completed");
  expect(
    (await service.longs.catalog.open(fresh.target.bookId)).book.workspaceIndex
      .ledger.commits
  ).toHaveLength(1);
}, 120_000);
