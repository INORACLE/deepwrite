import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DecompositionSubmitInput } from "@deepwrite/contracts";
import { decompositionSha } from "./content-guard";
import { runDecompositionFaux } from "./faux-run.test-support";
import { decompositionFixture } from "./test-support";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDecompositionRoots(roots);
});

type Fixture = Awaited<ReturnType<typeof decompositionFixture>>;

async function openBook(f: Fixture) {
  const job = await f.service.state.load(f.job.id);
  if (job.target?.kind !== "long") throw new Error("长篇目标未绑定。");
  const { bookId } = job.target;
  const { projectDirectory } = await f.longs.catalog.open(bookId);
  const index = async () =>
    (await f.longs.open({ bookId })).book.workspaceIndex;
  return { job, projectDirectory, index };
}

/**
 * Earlier versions pinned each beat to its chapter's arc; puts the saved
 * foreshadowing back into that shape, as on a user's existing task.
 */
async function pinBeatsToArcs(f: Fixture) {
  const { job, projectDirectory, index } = await openBook(f);
  await f.longs.store.transactManaged(projectDirectory, async (loaded) => {
    const cards = new Map(
      loaded.index.plot.chapterCards.map((card) => [card.id, card])
    );
    for (const thread of loaded.index.plot.foreshadowing)
      for (const beat of thread.beats)
        beat.arcId = cards.get(beat.chapterCardId!)!.primaryArcId;
    return { operations: [], result: undefined };
  });
  const threads = new Map(
    (await index()).plot.foreshadowing.map((thread) => [
      thread.id,
      decompositionSha(JSON.stringify(thread))
    ])
  );
  const unit = job.units["plot:foreshadowing"]!;
  unit.outputRefs = unit.outputRefs.map((ref) =>
    threads.has(ref.resourceId)
      ? { ...ref, sha256: threads.get(ref.resourceId)! }
      : ref
  );
  await f.service.state.save(job);
}

it("审校退回编年后按新的剧情点重写，伏笔触点跟随章节，旧剧情点被清理", async () => {
  const f = await decompositionFixture(
    "continuation",
    3,
    (order) =>
      `主角与人物1继续寻找铜铃。伏笔1${order === 3 ? "回收" : "埋设"}。`
  );
  roots.push(f.root);
  const book = await openBook(f);
  const point = (title: string, startOrder: number, endOrder: number) => ({
    title,
    summary: `${title}的经过。`,
    startOrder,
    endOrder
  });
  let firstStoryPath = "";
  let rewritten = false;
  const submit = f.service.submit.bind(f.service);
  vi.spyOn(f.service, "submit").mockImplementation(async (raw) => {
    let input: DecompositionSubmitInput = raw;
    // The plot review sends the chronicle back for repair.
    if (input.unitId === "review:plot" && input.data.kind === "review")
      input = {
        ...input,
        data: {
          kind: "review",
          review: {
            domain: "plot",
            issues: [
              {
                id: "issue_chapter_2",
                unitId: "chronicle:1",
                description: "第 2 章的经过与相邻章节不一致。",
                chapterOrders: [2],
                suggestion: "拆开剧情点并统一摘要。",
                resolution: "repair"
              }
            ]
          }
        }
      };
    const current = await f.service.state.load(input.jobId);
    if (
      input.unitId === "chronicle:1" &&
      input.data.kind === "asset" &&
      current.units["chronicle:1"]!.phase === "review"
    ) {
      await pinBeatsToArcs(f);
      firstStoryPath = (await book.index()).plot.storyPlots[0]!.file.path;
      // The repair splits the single point, so every chapter's arc moves.
      input = {
        ...input,
        data: {
          kind: "asset",
          asset: {
            kind: "chronicle",
            summary: "主角夜访后取得铜铃。",
            points: [point("夜访", 1, 1), point("得铃", 2, 3)]
          }
        }
      };
      rewritten = true;
    }
    return submit(input);
  });

  const job = await runDecompositionFaux(f);
  expect(rewritten).toBe(true);
  expect(job.status).toBe("completed");

  const index = await book.index();
  const titles = new Map(index.plot.arcs.map(({ id, title }) => [id, title]));
  expect(
    [...index.plot.arcs]
      .sort((a, b) => a.order - b.order)
      .map(({ title, order }) => [order, title])
  ).toEqual([
    [1, "夜访"],
    [2, "得铃"],
    [3, "源文剧情"]
  ]);
  expect(
    index.plot.chapterCards.map(({ primaryArcId }) => titles.get(primaryArcId!))
  ).toEqual(["夜访", "得铃", "得铃"]);
  expect(index.plot.storyPlots.map(({ title }) => title).sort()).toEqual(
    ["夜访", "得铃"].sort()
  );
  await expect(
    access(join(book.projectDirectory, firstStoryPath))
  ).rejects.toThrow();
  const beats = index.plot.foreshadowing.flatMap(({ beats }) => beats);
  expect(beats.length).toBeGreaterThan(0);
  expect(beats.every(({ arcId }) => arcId === null)).toBe(true);

  // Restarting rechecks every receipt against the book; nothing conflicts.
  const reloaded = await f.service.recover(
    await f.service.state.load(job.id),
    true
  );
  expect(reloaded.status).toBe("completed");
  expect(
    Object.values(reloaded.units).every(({ status }) => status === "done")
  ).toBe(true);
}, 60_000);
