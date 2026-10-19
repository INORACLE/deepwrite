import {
  readFile,
  rm,
  writeFile,
  rename,
  utimes,
  lstat
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as io from "../long-project-store/io";
import { DecompositionService } from "./service";
import { decompositionFixture } from "./test-support";
import { queryDecomposition } from "./query";
import { stageRecovery } from "../project-recovery.test-support";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDecompositionRoots(roots);
});

it("command-scoped services reuse validated source revisions and recovery inspects metadata only", async () => {
  const fixture = await decompositionFixture(
    "materials",
    50,
    (order) => `合成${order}章。` + "测试正文。".repeat(1000)
  );
  roots.push(fixture.root);
  await fixture.service.source(fixture.job);
  const disk = vi.spyOn(io, "readNoFollowFile");
  const next = new DecompositionService(
    fixture.root,
    fixture.longs,
    fixture.catalog
  );
  await next.assertSource(fixture.job);
  const status = await queryDecomposition(
    fixture.job,
    fixture.root,
    next.reader,
    { kind: "status" }
  );
  expect(status.content).toContain("phase");
  const sourcePath = join(
    fixture.sources.directory,
    fixture.source.id,
    "revisions",
    "1.json"
  );
  expect(disk.mock.calls.map(([path]) => path)).not.toContain(sourcePath);
  const returned = await next.source(fixture.job);
  returned.chapters[0]!.text = "只修改返回的对象";
  expect((await fixture.service.source(fixture.job)).chapters[0]!.text).toBe(
    fixture.source.chapters[0]!.text
  );
  const raw = await readFile(sourcePath, "utf8");
  const before = await lstat(sourcePath);
  await writeFile(sourcePath, raw.replace("合成1章", "篡改1章"));
  await utimes(sourcePath, before.atime, before.mtime);
  await expect(next.assertSource(fixture.job)).rejects.toThrow("指纹");
  await expect(
    queryDecomposition(fixture.job, fixture.root, next.reader, {
      kind: "status"
    })
  ).rejects.toThrow("指纹");
  await writeFile(`${sourcePath}.next`, raw);
  await rename(`${sourcePath}.next`, sourcePath);
  await expect(next.assertSource(fixture.job)).resolves.toBeUndefined();
});

it("warm source validation still rejects a source removed from the working directory", async () => {
  const fixture = await decompositionFixture("materials");
  roots.push(fixture.root);
  await fixture.service.assertSource(fixture.job);
  await rm(join(fixture.sources.directory, fixture.source.id), {
    recursive: true
  });
  await expect(fixture.service.assertSource(fixture.job)).rejects.toMatchObject(
    { code: "ENOENT" }
  );
  await expect(
    queryDecomposition(fixture.job, fixture.root, fixture.service.reader, {
      kind: "status"
    })
  ).rejects.toThrow(/来源不存在/u);
});

it("warm source validation recovers a pending revision transaction and detects changed bytes", async () => {
  const fixture = await decompositionFixture("materials");
  roots.push(fixture.root);
  await fixture.service.assertSource(fixture.job);
  const root = join(fixture.sources.directory, fixture.source.id);
  const raw = await readFile(join(root, "revisions/1.json"), "utf8");
  const staged = await stageRecovery(
    root,
    [
      {
        path: "revisions/1.json",
        content: raw.replace("继续寻找铜铃", "篡改寻找铜铃")
      }
    ],
    "committing"
  );
  await expect(fixture.service.assertSource(fixture.job)).rejects.toThrow(
    "指纹"
  );
  await expect(lstat(staged.journalPath)).rejects.toMatchObject({
    code: "ENOENT"
  });
});
