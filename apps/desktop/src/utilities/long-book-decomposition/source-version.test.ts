import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { decompositionFixture } from "./test-support";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";
const roots: string[] = [];
afterEach(async () => {
  await cleanupDecompositionRoots(roots);
});
it("章节校对新建不可变版本，旧任务仍读取旧正文，确认绑定版本与范围", async () => {
  const fixture = await decompositionFixture("materials");
  roots.push(fixture.root);
  const chapters = fixture.source.chapters.map((chapter, index) =>
    index
      ? chapter
      : { ...chapter, title: "校对标题", text: "全新正文", charCount: 4 }
  );
  const next = await fixture.sources.saveChapters({
    sourceId: fixture.source.id,
    baseRevision: fixture.source.revision!,
    chapters
  });
  expect(next.revision).toBe(fixture.source.revision! + 1);
  expect(next.fingerprint).not.toBe(fixture.source.fingerprint);
  expect((await fixture.service.source(fixture.job)).chapters[0]!.text).toBe(
    fixture.source.chapters[0]!.text
  );
  await expect(
    fixture.sources.saveChapters({
      sourceId: fixture.source.id,
      baseRevision: fixture.source.revision!,
      chapters
    })
  ).rejects.toThrow();
  await expect(
    fixture.sources.confirm({
      sourceId: fixture.source.id,
      sourceRevision: next.revision!,
      fingerprint: fixture.source.fingerprint!,
      range: { start: 1, end: 3 }
    })
  ).rejects.toThrow();
  await expect(
    fixture.sources.confirm({
      sourceId: fixture.source.id,
      sourceRevision: next.revision!,
      fingerprint: next.fingerprint!,
      range: { start: 1, end: 4 }
    })
  ).rejects.toThrow();
  const confirmation = await fixture.sources.confirm({
    sourceId: fixture.source.id,
    sourceRevision: next.revision!,
    fingerprint: next.fingerprint!,
    range: { start: 1, end: 2 }
  });
  expect(confirmation.range).toEqual({ start: 1, end: 2 });
  await expect(
    fixture.service.create(
      {
        ...fixture.job,
        id: "ldjob_stale",
        phase: "prepare_target",
        target: undefined,
        units: {}
      },
      {
        book: join(fixture.root, "books"),
        materials: join(fixture.root, "materials"),
        groups: join(fixture.root, "groups")
      }
    )
  ).rejects.toThrow("新版本");
});
it("源文被篡改后不能恢复或继续；任务删除保留真实目标", async () => {
  const fixture = await decompositionFixture("materials");
  roots.push(fixture.root);
  const path = join(
    fixture.sources.directory,
    fixture.source.id,
    "revisions",
    `${fixture.source.revision}.json`
  );
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace("继续寻找铜铃", "篡改寻找铜铃"));
  await expect(
    fixture.service.recover(
      await fixture.service.state.load(fixture.job.id),
      true
    )
  ).rejects.toThrow("指纹");
  await fixture.service.control({ jobId: fixture.job.id, action: "delete" });
  expect((await fixture.catalog.indexSnapshot()).materials).toHaveLength(5);
  expect((await fixture.catalog.indexSnapshot()).materialGroups).toHaveLength(
    1
  );
});
