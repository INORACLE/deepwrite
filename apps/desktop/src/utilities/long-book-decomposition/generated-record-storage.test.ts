import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DECOMPOSITION_RECORD_MAX_BYTES,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import {
  DecompositionRecordStore,
  decompositionRecordId
} from "./record-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-overview-record-"))
  );
  roots.push(root);
  const job = {
    id: "ldjob_overview_record",
    outputVersion: 1,
    units: {
      "summary:characters": { inputRevision: "rev_overview" },
      "review:character": { inputRevision: "rev_review" }
    }
  } as unknown as LongBookDecompositionJob;
  return { root, job, store: new DecompositionRecordStore(() => root) };
}
const data = (content: string) => ({
  kind: "asset" as const,
  asset: {
    kind: "topic" as const,
    domain: "character" as const,
    title: "人物概览",
    content
  }
});

it("超过旧 8 MiB 上限的本地概览可保存、重启读取，再写其他任务记录", async () => {
  const { root, job, store } = await fixture();
  const overview = data('人物摘要😀\n"'.repeat(500_000));
  const id = await store.save(job, "summary:characters", overview);
  expect(
    (await stat(join(root, "records", `${id}.json`))).size
  ).toBeGreaterThan(8 * 1024 * 1024);
  const restarted = new DecompositionRecordStore(() => root);
  expect((await restarted.record(job, "summary:characters")).data).toEqual(
    overview
  );
  await restarted.save(job, "review:character", {
    kind: "review",
    review: { domain: "character", issues: [] }
  });
  expect((await restarted.read(job.id, id)).record.data).toEqual(overview);
});

it("序列化转义后超过本地上限时拒绝写入，并保留已保存的概览", async () => {
  const { job, store } = await fixture();
  const original = data("# 人物概览");
  await store.save(job, "summary:characters", original);
  const oversized = data(
    `开${"\n".repeat(DECOMPOSITION_RECORD_MAX_BYTES / 2)}尾`
  );
  const id = decompositionRecordId(job, "summary:characters");
  await expect(
    store.save(job, "summary:characters", oversized)
  ).rejects.toThrow(`项目事务文件超过大小限制：records/${id}.json`);
  expect((await store.record(job, "summary:characters")).data).toEqual(
    original
  );
});
