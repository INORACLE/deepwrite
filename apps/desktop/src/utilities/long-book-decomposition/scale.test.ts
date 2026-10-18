import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { splitDecompositionChunks } from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";
import { runDecompositionFaux } from "./faux-run.test-support";
import { queryDecomposition } from "./query";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

it("300 章、3 卷、20 人物、15 伏笔的续写目标与 v5 账本完整一致", async () => {
  const names = Array.from({ length: 19 }, (_, i) => `人物${i + 1}`).join("、");
  const fixture = await decompositionFixture(
    "continuation",
    300,
    (order) =>
      `主角与${names}在第 ${order} 章推进目标。` +
      (order === 1 || order === 300
        ? Array.from(
            { length: 15 },
            (_, i) => `伏笔${i + 1}${order === 1 ? "埋设" : "回收"}。`
          ).join("")
        : "")
  );
  roots.push(fixture.root);
  expect(fixture.job.lastError).toBeUndefined();
  const prepared = await fixture.longs.open({
    bookId:
      fixture.job.target!.kind === "long" ? fixture.job.target!.bookId : ""
  });
  expect(prepared.book.workspaceIndex.chapters).toHaveLength(300);
  expect(prepared.book.workspaceIndex.ledger.commits).toHaveLength(0);
  const started = performance.now();
  const job = await runDecompositionFaux(fixture);
  if (job.target?.kind !== "long") throw new Error("目标类型错误");
  const opened = await fixture.longs.catalog.open(job.target.bookId);
  const index = opened.book.workspaceIndex;
  expect(index.plot.volumes).toHaveLength(3);
  expect(index.characters).toHaveLength(20);
  expect(index.plot.foreshadowing).toHaveLength(15);
  expect(index.ledger.commits).toHaveLength(1);
  expect(index.ledger.commits[0]!.mode).toBe("text_files_batch");
  expect(
    index.chapters.every(
      ({ bodyStatus, commitId }) =>
        bodyStatus === "written" && commitId === index.ledger.commits[0]!.id
    )
  ).toBe(true);
  expect(
    index.plot.foreshadowing.every(
      ({ status, beats }) =>
        status === "resolved" &&
        beats.every(({ status }) => status === "committed")
    )
  ).toBe(true);
  expect(
    index.chapters
      .slice(0, -1)
      .every(({ characterContinuity }) => characterContinuity.length === 0)
  ).toBe(true);
  expect(index.chapters.at(-1)!.characterContinuity).toHaveLength(1);
  const recovered = await fixture.service.recover(
    await fixture.service.state.load(job.id),
    true
  );
  expect(
    Object.values(recovered.units).every(({ status }) => status === "done")
  ).toBe(true);
  console.info(
    JSON.stringify({
      decompositionScale: 300,
      characters: 20,
      foreshadows: 15,
      elapsedMs: Math.round(performance.now() - started),
      stateBytes: (
        await stat(join(fixture.service.state.directory(job.id), "job.json"))
      ).size
    })
  );
}, 600_000);

it("3000 章、300 万字的切分、来源准备、任务状态与分页保持有界", async () => {
  const start = performance.now();
  const fixture = await decompositionFixture("materials", 3000, (order) =>
    (`合成第${order}章，主角推进目标。` + "合成正文。".repeat(220)).slice(
      0,
      1000
    )
  );
  roots.push(fixture.root);
  expect(fixture.job.lastError).toBeUndefined();
  const splitStart = performance.now();
  const chunks = splitDecompositionChunks(fixture.source.chapters, {
    contextWindow: 128_000,
    maxTokens: 8192
  });
  const splitMs = performance.now() - splitStart;
  expect(chunks.flatMap(({ chapterIds }) => chapterIds)).toHaveLength(3000);
  expect(
    chunks.every(
      ({ chapterIds, estimatedTokens }) =>
        chapterIds.length <= 20 && estimatedTokens <= 60_000
    )
  ).toBe(true);
  const result = await queryDecomposition(
    fixture.job,
    fixture.root,
    fixture.service.reader,
    { kind: "chunkText", chunkId: chunks[0]!.id }
  );
  expect(result.content.length).toBeLessThanOrEqual(12_000);
  expect(result.nextCursor).not.toBeNull();
  const size = (
    await stat(
      join(fixture.service.state.directory(fixture.job.id), "job.json")
    )
  ).size;
  expect(size).toBeLessThan(3 * 1024 * 1024);
  expect(splitMs).toBeLessThan(2000);
  console.info(
    JSON.stringify({
      decompositionScale: 3000,
      sourceCharacters: fixture.source.chapters.reduce(
        (sum, { text }) => sum + text.length,
        0
      ),
      splitMs: Math.round(splitMs),
      prepareMs: Math.round(performance.now() - start),
      stateBytes: size
    })
  );
}, 90_000);

it("3000 章、300 万字的真实源文准备与原生 v5 批次提交保持完整", async () => {
  const started = performance.now();
  const fixture = await decompositionFixture("continuation", 3000, (order) =>
    (`合成第${order}章。` + "合成正文。".repeat(220)).slice(0, 1000)
  );
  roots.push(fixture.root);
  expect(fixture.job.lastError).toBeUndefined();
  if (fixture.job.target?.kind !== "long") throw new Error("长篇目标未绑定。");
  const preparedMs = performance.now() - started;
  console.info(
    JSON.stringify({
      decompositionSourceBatchPhase: "prepared",
      prepareMs: Math.round(preparedMs)
    })
  );
  const opened = await fixture.longs.catalog.open(fixture.job.target.bookId);
  const index = opened.book.workspaceIndex;
  expect(index.chapters).toHaveLength(3000);
  const latest = index.chapters.at(-1)!;
  await fixture.longs.store.writeChapter(opened.projectDirectory, {
    chapterCardId: latest.chapterCardId,
    body: { content: fixture.source.chapters.at(-1)!.text },
    characterState: { content: "合成样书末章的主角状态。" },
    handoff: { content: "从合成末章之后继续创作。" }
  });
  const commitStart = performance.now();
  const committed = await fixture.longs.store.commitChapter(
    opened.projectDirectory,
    {
      mode: "text_files_batch",
      chapterCardIds: index.chapters.map(({ chapterCardId }) => chapterCardId),
      checkpointChapterCardId: latest.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "合成 300 万字性能验收"
    }
  );
  const commitMs = performance.now() - commitStart;
  const restored = await fixture.longs.store.openBook(opened.projectDirectory);
  expect(committed.record.schemaVersion).toBe(5);
  expect(committed.record.chapterCardIds).toHaveLength(3000);
  expect(restored.book.workspaceIndex.ledger.commits).toHaveLength(1);
  expect(
    restored.book.workspaceIndex.chapters.every(
      ({ commitId }) => commitId === committed.record.id
    )
  ).toBe(true);
  for (const chapter of [index.chapters[0]!, latest]) {
    const document = await fixture.longs.store.readDocument(
      opened.projectDirectory,
      { fileId: chapter.body.id }
    );
    const sourceIndex = chapter === latest ? 2999 : 0;
    expect(document.content).toBe(fixture.source.chapters[sourceIndex]!.text);
  }
  console.info(
    JSON.stringify({
      decompositionSourceBatchScale: 3000,
      sourceCharacters: 3_000_000,
      prepareMs: Math.round(preparedMs),
      commitMs: Math.round(commitMs)
    })
  );
}, 600_000);
