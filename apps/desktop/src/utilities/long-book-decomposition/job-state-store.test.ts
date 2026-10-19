import { mkdir, mkdtemp, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DecompositionJobStateStore } from "./job-state-store";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

const roots: string[] = [];
afterEach(async () => {
  await cleanupDecompositionRoots(roots);
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-completion-"))
  );
  roots.push(root);
  const state = new DecompositionJobStateStore(root);
  const id = "ldjob_completion_fixture";
  await mkdir(state.directory(id), { recursive: true });
  return { root, state, id };
}

it("1910 个单元的旧版完成日志超过 1 MB 后仍可重启读取与完成保存", async () => {
  const { root, state, id } = await fixture();
  const value = {
    commitId: "commit_completion_fixture",
    postCommitRefs: Object.fromEntries(
      Array.from({ length: 1910 }, (_, index) => [
        `reading:chapter_${index + 1}`,
        Array.from({ length: 4 }, (_, slot) => ({
          projectId: "book_completion_fixture",
          resourceId: `resource_${index + 1}_${slot}`,
          fileId: `file_${index + 1}_${slot}`,
          revision: index + 1,
          sha256: "a".repeat(64)
        }))
      ])
    )
  };
  await state.saveCompletion(id, value);
  expect(
    (await stat(join(state.directory(id), "completion.json"))).size
  ).toBeGreaterThan(1024 * 1024);
  const restarted = new DecompositionJobStateStore(root);
  expect(await restarted.completion(id)).toEqual(value);
  await restarted.saveCompletion(id, {
    ...(await restarted.completion(id)),
    finalized: true
  });
  expect(await state.completion(id)).toEqual({ ...value, finalized: true });
});

it("超过任务文件上限的完成日志在写入前被拒绝，保留原来的完成记录", async () => {
  const { state, id } = await fixture();
  const original = { commitId: "commit_completion_fixture" };
  await state.saveCompletion(id, original);
  const refs = Array.from({ length: 10_000 }, () => ({
    projectId: "p".repeat(256),
    resourceId: "r".repeat(256),
    fileId: "f".repeat(256),
    revision: 1,
    sha256: "a".repeat(64)
  }));
  await expect(
    state.saveCompletion(id, {
      ...original,
      postCommitRefs: Object.fromEntries(
        Array.from({ length: 4 }, (_, index) => [`unit_${index}`, refs])
      )
    })
  ).rejects.toThrow("项目事务文件超过大小限制：completion.json");
  expect(await state.completion(id)).toEqual(original);
});
