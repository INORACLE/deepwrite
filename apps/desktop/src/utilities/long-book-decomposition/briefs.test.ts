import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeDecompositionRegistry,
  type DecompositionAsset,
  type DecompositionReadingCard,
  type DecompositionRecord,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import { buildDecompositionBrief, type BriefContext } from "./briefs";
import { briefTokens } from "./brief-text";
import { queryDecomposition } from "./query";
import { decompositionFixture } from "./test-support";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

const roots: string[] = [];
afterEach(() => cleanupDecompositionRoots(roots));

const card = (
  order: number,
  facts: Array<[string, string]>
): DecompositionReadingCard => ({
  chunkId: "chunk:1",
  chapters: [
    {
      chapterId: `source_chapter_${order}`,
      order,
      title: `第 ${order} 章`,
      summary: `第 ${order} 章梗概。`,
      events: [],
      characters: [...new Set(facts.map(([name]) => name))]
    }
  ],
  characters: [...new Set(facts.map(([name]) => name))].map((name) => ({
    name,
    aliases: [],
    facts: facts
      .filter(([who]) => who === name)
      .map(([, text]) => ({ text, chapterOrder: order }))
  })),
  world: [],
  plot: { events: [], foreshadowing: [] },
  style: { notes: [], excerpts: [] }
});

function context(
  job: LongBookDecompositionJob,
  cards: DecompositionReadingCard[],
  assets: Record<string, DecompositionAsset> = {},
  records: Record<string, DecompositionRecord> = {}
): BriefContext {
  return {
    job,
    chapters: [],
    cards: async () => cards,
    registry: async () =>
      normalizeDecompositionRegistry(
        {
          characters: [
            {
              id: "rc_main",
              name: "主角",
              aliases: ["阿铃"],
              tier: "protagonist",
              firstChapterOrder: 1,
              chunkCount: 3
            }
          ],
          terms: []
        },
        1
      ),
    record: async (id) => records[id]!,
    asset: async (id) => assets[id],
    repairs: async (id) =>
      id === "character:rc_main" ? ["最新状态与第 3 章不符"] : [],
    draft: async () => undefined
  };
}

function unit(
  job: LongBookDecompositionJob,
  id: string,
  dependencies: string[] = []
) {
  job.units[id] = {
    phase: "integrate",
    status: "running",
    attempts: 0,
    inputRevision: "revision",
    dependencies,
    outputRefs: [],
    receiptIds: [],
    updatedAt: new Date().toISOString()
  };
}

describe("decomposition evidence packs", () => {
  it("hands a reader its unsaved chapters with their checkpoint ids", async () => {
    const { job, root, service } = await decompositionFixture("materials", 3);
    roots.push(root);
    const pack = async () =>
      (
        await queryDecomposition(job, root, service.reader, {
          kind: "brief",
          unitIds: ["chunk:1"]
        })
      ).content;
    expect(await pack()).toContain(
      "### reading:source_chapter_2｜chapterId=source_chapter_2｜order=2｜title=第 2 章"
    );
    expect(await pack()).toContain("主角在第 2 章继续寻找铜铃。");
    job.units["reading:source_chapter_2"]!.status = "done";
    const resumed = await pack();
    expect(resumed).toContain("已保存，无需再交：reading:source_chapter_2");
    expect(resumed).not.toContain("主角在第 2 章继续寻找铜铃。");
  });

  it("builds a final dossier from saved biographies and recent mentions", async () => {
    const { job, root } = await decompositionFixture("materials", 3);
    roots.push(root);
    unit(job, "character-volume:rc_main:1");
    unit(job, "character:rc_main", ["character-volume:rc_main:1"]);
    const pack = await buildDecompositionBrief(
      context(job, [card(3, [["阿铃", "敲响铜铃。"]])], {
        "character-volume:rc_main:1": {
          kind: "character-volume",
          registryId: "rc_main",
          volume: "第 1 卷",
          startOrder: 1,
          endOrder: 3,
          content: "第一卷小传：主角离乡。"
        }
      }),
      ["character:rc_main"],
      50_000
    );
    expect(pack).toContain("【已保存的分卷小传 character-volume:rc_main:1】");
    expect(pack).toContain("第一卷小传：主角离乡。");
    expect(pack).toContain("第3章：敲响铜铃。");
    expect(pack).toContain("最新状态与第 3 章不符");
  });

  it("samples oversized evidence evenly within the budget", async () => {
    const { job, root } = await decompositionFixture("materials", 3);
    roots.push(root);
    unit(job, "character:rc_main");
    const cards = Array.from({ length: 400 }, (_, index) =>
      card(index + 1, [
        ["主角", `第 ${index + 1} 次出手，记录细节。`.repeat(4)]
      ])
    );
    const pack = await buildDecompositionBrief(
      context(job, cards),
      ["character:rc_main"],
      6000
    );
    expect(briefTokens(pack)).toBeLessThanOrEqual(6600);
    expect(pack).toContain("已按章节均匀保留");
    expect(pack).toMatch(/第3\d\d章：/u);
  });

  it("numbers a registry part's names and leaves the merge only cross-part clusters", async () => {
    const { job, root } = await decompositionFixture("materials", 3);
    roots.push(root);
    unit(job, "registry:part:1");
    unit(job, "registry:part:2");
    unit(job, "registry:merge", ["registry:part:1", "registry:part:2"]);
    job.units["registry:part:1"]!.registryRefs = ["c1"];
    job.units["registry:part:2"]!.registryRefs = ["c2", "c3"];
    const cards = [
      card(1, [["铃铛客", "夜里摇铃。"]]),
      card(2, [
        ["铃铛", "铃声又起。"],
        ["路人甲", "在桥头围观。"]
      ])
    ];
    const entry = (id: string, name: string, tier: string) => ({
      id,
      name,
      aliases: [],
      tier: tier as "passerby",
      firstChapterOrder: 1,
      chunkCount: 1
    });
    const records: Record<string, DecompositionRecord> = {
      "registry:part:1": {
        unitId: "registry:part:1",
        data: {
          kind: "registry",
          registry: {
            characters: [entry("c1", "铃铛客", "minor_supporting")],
            terms: []
          }
        }
      },
      "registry:part:2": {
        unitId: "registry:part:2",
        data: {
          kind: "registry",
          registry: {
            characters: [
              entry("c2", "铃铛", "major_supporting"),
              entry("c3", "路人甲", "passerby")
            ],
            terms: []
          }
        }
      }
    };
    const part = await buildDecompositionBrief(
      context(job, cards, {}, records),
      ["registry:part:2"],
      50_000
    );
    expect(part).toContain("共 2 个编号");
    expect(part).toMatch(
      /^c2｜铃铛｜别名：无｜首次第2章｜1 章提及｜第2章：铃声又起。$/mu
    );
    expect(part).not.toContain("铃铛客");
    const merge = await buildDecompositionBrief(
      context(job, cards, {}, records),
      ["registry:merge"],
      50_000
    );
    expect(merge).toContain("以下 1 个候选簇");
    expect(merge).toContain("候选簇 1：\nc2｜人物｜铃铛｜主要配角");
    expect(merge).toContain("c1｜人物｜铃铛客｜次要配角");
    expect(merge).not.toContain("路人甲");
  });
});
