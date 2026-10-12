import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LongBookDecompositionJobSchema } from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it("续写源文写入后创建中断，继续同一任务保留正文且不重复建长篇", async () => {
  const f = await decompositionFixture("continuation", 3);
  roots.push(f.root);
  const job = LongBookDecompositionJobSchema.parse({
    ...f.job,
    id: "ldjob_creation_recovery",
    target: undefined,
    phase: "prepare_target",
    status: "idle",
    units: {}
  });
  const original = f.longs.store.transactManaged.bind(f.longs.store);
  let transactions = 0;
  vi.spyOn(f.longs.store, "transactManaged").mockImplementation(
    async (path, mutate) => {
      const result = await original(path, mutate);
      if (++transactions === 2) throw new Error("模拟源文写入后断开");
      return result;
    }
  );
  const created = await f.service.create(job, {
    book: join(f.root, "books"),
    materials: join(f.root, "materials"),
    groups: join(f.root, "groups")
  });
  expect(created).toMatchObject({
    id: job.id,
    phase: "prepare_target",
    status: "failed",
    lastError: "模拟源文写入后断开"
  });
  expect(await f.service.state.load(job.id)).toMatchObject({
    status: "failed"
  });
  const resumed = await f.service.control({ jobId: job.id, action: "resume" });
  expect(resumed).toMatchObject({
    id: job.id,
    phase: "read",
    status: "idle",
    target: { kind: "long", state: "ready" }
  });
  expect(resumed).not.toHaveProperty("lastError");
  if (resumed?.target?.kind !== "long") throw new Error("目标未恢复");
  const opened = await f.longs.catalog.open(resumed.target.bookId);
  expect(opened.book.workspaceIndex.chapters).toHaveLength(3);
  for (const [
    index,
    chapter
  ] of opened.book.workspaceIndex.chapters.entries()) {
    const document = await f.longs.store.readDocument(opened.projectDirectory, {
      fileId: chapter.body.id
    });
    expect(document.content).toBe(f.source.chapters[index]!.text);
  }
  await f.service.control({ jobId: job.id, action: "resume" });
  const books = await f.longs.catalog.list();
  expect(books.books).toHaveLength(2);
  expect(
    (await f.longs.catalog.open(resumed.target.bookId)).book.workspaceIndex
      .chapters
  ).toHaveLength(3);
}, 30_000);
