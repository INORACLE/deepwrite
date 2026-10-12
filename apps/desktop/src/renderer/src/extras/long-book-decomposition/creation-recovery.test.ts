import { expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type {
  DeepWriteApi,
  LongBookDecompositionJob,
  SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { createDecompositionCreationRecovery } from "./creation-recovery";

function fixture() {
  const saved = {
    id: "ldjob_timed_out",
    phase: "prepare_target"
  } as LongBookDecompositionJob;
  const other = { ...saved, id: "ldjob_other" };
  const job = shallowRef<LongBookDecompositionJob | null>(null);
  const jobs = shallowRef<LongBookDecompositionJob[]>([]);
  const listJobs = vi.fn(async () => [other, saved]);
  let disposed = false;
  const recovery = createDecompositionCreationRecovery({
    api: () =>
      ({ longBookDecomposition: { listJobs } }) as unknown as DeepWriteApi,
    job,
    jobs,
    isDisposed: () => disposed
  });
  const cause = {
    code: "decomposition.command_timeout",
    message: "合成创建超时",
    details: { jobId: saved.id }
  };
  const event = {
    type: "decomposition.target_updated",
    payload: { jobId: saved.id }
  } as SystemEventEnvelope;
  return {
    recovery,
    saved,
    other,
    job,
    jobs,
    listJobs,
    cause,
    event,
    dispose: () => {
      disposed = true;
    }
  };
}

it("创建回复丢失后接回同一任务，不选择列表中的其他任务", async () => {
  const f = fixture();
  await f.recovery.recover(f.cause);
  expect(f.job.value).toBe(f.saved);
  expect(f.jobs.value).toEqual([f.other, f.saved]);
  expect(f.listJobs).toHaveBeenCalledTimes(1);
});

it("任务尚未落盘时，后台完成事件接回后来保存的原任务", async () => {
  const f = fixture();
  f.listJobs.mockResolvedValueOnce([]);
  await f.recovery.recover(f.cause);
  expect(f.job.value).toBeNull();
  f.recovery.handleEvent(f.event);
  await vi.waitFor(() => expect(f.job.value).toBe(f.saved));
  expect(f.listJobs).toHaveBeenCalledTimes(2);
});

it("已接回准备中的任务，后台完成后更新到可运行阶段", async () => {
  const f = fixture();
  await f.recovery.recover(f.cause);
  const ready = { ...f.saved, phase: "read" as const };
  f.listJobs.mockResolvedValueOnce([ready]);
  f.recovery.handleEvent(f.event);
  await vi.waitFor(() => expect(f.job.value?.phase).toBe("read"));
  f.recovery.handleEvent(f.event);
  expect(f.listJobs).toHaveBeenCalledTimes(2);
});

it("首次恢复读取失败时，手动刷新仍能找到原任务", async () => {
  const f = fixture();
  f.listJobs.mockRejectedValueOnce(new Error("模拟临时读取失败"));
  await expect(f.recovery.recover(f.cause)).rejects.toThrow("读取失败");
  f.recovery.adopt([f.saved]);
  expect(f.job.value).toBe(f.saved);
});

it("创建失败后的旧列表迟到，不覆盖后台完成事件得到的新列表", async () => {
  const f = fixture();
  let resolve!: (jobs: LongBookDecompositionJob[]) => void;
  f.listJobs.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const recovering = f.recovery.recover(f.cause);
  const ready = { ...f.saved, phase: "read" as const };
  f.listJobs.mockResolvedValueOnce([ready]);
  f.recovery.handleEvent(f.event);
  await vi.waitFor(() => expect(f.job.value).toBe(ready));
  resolve([]);
  await recovering;
  expect(f.jobs.value).toEqual([ready]);
  expect(f.job.value).toBe(ready);
});

it("恢复读取期间选中其他任务，不被迟到回复替换", async () => {
  const f = fixture();
  let resolve!: (jobs: LongBookDecompositionJob[]) => void;
  f.listJobs.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const recovering = f.recovery.recover(f.cause);
  f.job.value = f.other;
  resolve([f.saved, f.other]);
  await recovering;
  expect(f.job.value).toBe(f.other);
  f.recovery.handleEvent(f.event);
  expect(f.listJobs).toHaveBeenCalledTimes(1);
});

it("没有合法任务 ID 的错误只刷新列表，不猜测任务身份", async () => {
  const f = fixture();
  await f.recovery.recover({ ...f.cause, details: { jobId: "../unsafe" } });
  expect(f.job.value).toBeNull();
  expect(f.jobs.value).toHaveLength(2);
});

it("控制器销毁后不应用迟到的恢复结果", async () => {
  const f = fixture();
  let resolve!: (jobs: LongBookDecompositionJob[]) => void;
  f.listJobs.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const recovering = f.recovery.recover(f.cause);
  f.dispose();
  resolve([f.saved]);
  await recovering;
  expect(f.job.value).toBeNull();
  expect(f.jobs.value).toEqual([]);
});
