import { afterEach, expect, it } from "vitest";
import type { DecompositionSubmitInput } from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";
import { addDecompositionUnit } from "./workflow";
import { queryDecomposition } from "./query";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

const roots: string[] = [];
afterEach(async () => {
  await cleanupDecompositionRoots(roots);
});

async function setup() {
  const fixture = await decompositionFixture("materials", 3);
  roots.push(fixture.root);
  const { service, job } = fixture;
  const submit = (
    unitId: string,
    attemptId: string,
    data: DecompositionSubmitInput["data"]
  ) =>
    service.state.load(job.id).then((current) =>
      service.submit({
        jobId: job.id,
        outputVersion: job.outputVersion,
        unitId,
        attemptId,
        inputRevision: current.units[unitId]!.inputRevision,
        data
      })
    );
  const open = (phase: "read" | "registry" | "integrate", unitIds: string[]) =>
    service.open(
      { jobId: job.id, phase, unitIds },
      job.profile.id,
      `ldattempt_${unitIds[0]!.replace(/[^a-z0-9]/giu, "_")}`
    );
  const finish = (attemptId: string) =>
    service.control({ jobId: job.id, action: "finish-package", attemptId });
  return { ...fixture, submit, open, finish };
}

/** Reads all three chapters, naming the given characters in each. */
async function read(
  context: Awaited<ReturnType<typeof setup>>,
  names: Array<Array<[string, string[]]>>
) {
  const { input } = await context.open("read", ["chunk:1"]);
  for (const [index, chapter] of context.source.chapters.entries())
    await context.submit(`reading:${chapter.id}`, input.attemptId, {
      kind: "reading",
      card: {
        chunkId: "chunk:1",
        chapters: [
          {
            chapterId: chapter.id,
            order: chapter.order,
            title: chapter.title,
            summary: "主角寻找铜铃。",
            events: [],
            characters: names[index]!.map(([name]) => name)
          }
        ],
        characters: names[index]!.map(([name, aliases]) => ({
          name,
          aliases,
          facts: [{ text: `${name}出场。`, chapterOrder: chapter.order }]
        })),
        world: [],
        plot: { events: [], foreshadowing: [] },
        style: { notes: [], excerpts: [] }
      }
    });
  await context.submit("chunk:1", input.attemptId, { kind: "finish-card" });
  await context.finish(input.attemptId);
  return context.service.advance(
    await context.service.state.load(context.job.id)
  );
}

it("turns a registrar's numbered plan into the registry and merges a single part without a model", async () => {
  const context = await setup();
  const planned = await read(context, [
    [
      ["主角", ["阿铃"]],
      ["路人", []]
    ],
    [["阿铃", []]],
    [["黑衣人", []]]
  ]);
  expect(planned.phase).toBe("registry");
  expect(planned.units["registry:part:1"]!.registryRefs).toEqual([
    "c1",
    "c3",
    "c2",
    "c4"
  ]);
  const brief = await queryDecomposition(
    planned,
    context.root,
    context.service.reader,
    { kind: "brief", unitIds: ["registry:part:1"] }
  );
  expect(brief.content).toContain("c3｜阿铃｜别名：无｜首次第2章");
  const { input } = await context.open("registry", ["registry:part:1"]);
  await context.submit("registry:part:1", input.attemptId, {
    kind: "registry-plan",
    plan: {
      groups: [{ refs: ["c1", "c3"], tier: "protagonist" }],
      ignored: ["c4"]
    }
  });
  const job = await context.service.state.load(context.job.id);
  expect(job.units["registry:merge"]!.status).toBe("done");
  const merged = await context.service.reader.record(job, "registry:merge");
  expect(merged.data).toMatchObject({
    kind: "registry",
    registry: {
      characters: [
        {
          id: "c1",
          name: "主角",
          aliases: ["阿铃"],
          tier: "protagonist",
          chunkCount: 2
        },
        { id: "c2", name: "路人", tier: "passerby" },
        { id: "c4", name: "黑衣人", ignored: true }
      ]
    }
  });
  await context.finish(input.attemptId);
  const advanced = await context.service.advance(
    await context.service.state.load(context.job.id)
  );
  expect(advanced.phase).toBe("integrate");
  expect(advanced.units["character:c1"]).toBeDefined();
  expect(advanced.units["character:c2"]).toBeUndefined();
});

it("re-plans unfinished fixed-size registry parts on resume", async () => {
  const context = await setup();
  await read(context, [[["主角", []]], [["阿铃", []]], [["黑衣人", []]]]);
  const legacy = await context.service.state.load(context.job.id);
  delete legacy.units["registry:part:1"]!.registryRefs;
  legacy.units["registry:part:1"]!.status = "failed";
  legacy.units["registry:part:1"]!.attempts = 3;
  legacy.status = "failed";
  await context.service.state.save(legacy);
  const resumed = (await context.service.control({
    jobId: context.job.id,
    action: "resume"
  }))!;
  expect(resumed.units["registry:part:1"]).toBeUndefined();
  expect(resumed.units["registry:part:2"]).toMatchObject({
    status: "pending",
    registryRefs: ["c1", "c2", "c3"]
  });
  expect(resumed.units["registry:merge"]!.dependencies).toEqual([
    "registry:part:2"
  ]);
});

it.each([false, true])(
  "preserves staged points when finishing with text only: %s",
  async (textOnly) => {
    const context = await setup();
    const job = await context.service.state.load(context.job.id);
    job.units = {};
    job.phase = "integrate";
    job.chronicleSegments = [{ id: "chronicle:1", chunkIds: ["chunk:1"] }];
    addDecompositionUnit(job, "chronicle:1", "integrate");
    await context.service.state.save(job);
    const { input } = await context.open("integrate", ["chronicle:1"]);
    const point = (title: string, order: number) => ({
      title,
      summary: `${title}的经过。`,
      startOrder: order,
      endOrder: order
    });
    const staged = await context.submit("chronicle:1", input.attemptId, {
      kind: "asset-part",
      asset: { kind: "chronicle", points: [point("夜访", 1), point("得铃", 2)] }
    });
    expect(staged).toMatchObject({ staged: 2, refs: [] });
    let current = await context.service.state.load(context.job.id);
    expect(current.units["chronicle:1"]!.status).toBe("running");
    const brief = await queryDecomposition(
      current,
      context.root,
      context.service.reader,
      { kind: "brief", unitIds: ["chronicle:1"] }
    );
    expect(brief.content).toContain("【chronicle:1 已暂存 2 条】");
    expect(brief.content).toContain("提交空条目列表即可收尾");
    // A final call can add points, or only the required text after all points were staged.
    await context.submit("chronicle:1", input.attemptId, {
      kind: "asset",
      asset: {
        kind: "chronicle",
        summary: "主角取回铜铃。",
        points: textOnly ? [] : [point("得铃", 2), point("离城", 3)]
      }
    });
    current = await context.service.state.load(context.job.id);
    expect(current.units["chronicle:1"]!.status).toBe("done");
    const record = await context.service.reader.record(current, "chronicle:1");
    expect(record.data).toMatchObject({
      kind: "asset",
      asset: {
        summary: "主角取回铜铃。",
        points: textOnly
          ? [{ title: "夜访" }, { title: "得铃" }]
          : [{ title: "夜访" }, { title: "得铃" }, { title: "离城" }]
      }
    });
    expect(
      await context.service.records.draft(current, "chronicle:1")
    ).toBeUndefined();
  }
);

it("splits names by the model budget and asks the registrar only about cross-part clusters", async () => {
  const context = await setup();
  const narrow = await context.service.state.load(context.job.id);
  // About 68 names per part for this output limit and thinking level.
  narrow.models.integration = {
    ...narrow.models.integration,
    maxTokens: 1000,
    thinkingLevel: "high"
  };
  await context.service.state.save(narrow);
  const crowd = (prefix: string): Array<[string, string[]]> =>
    Array.from({ length: 60 }, (_, i) => [`${prefix}${i}`, []]);
  const planned = await read(context, [
    [["铃铛客", []], ...crowd("甲")],
    crowd("乙"),
    [["铃铛", []], ...crowd("丙")]
  ]);
  const parts = Object.keys(planned.units).filter((id) =>
    id.startsWith("registry:part:")
  );
  expect(parts.length).toBe(3);
  for (const id of parts) {
    const refs = planned.units[id]!.registryRefs!;
    const ringer = refs.find((ref) => ["c1", "c122"].includes(ref));
    const { input } = await context.open("registry", [id]);
    await context.submit(id, input.attemptId, {
      kind: "registry-plan",
      plan: {
        groups: ringer ? [{ refs: [ringer], tier: "major_supporting" }] : [],
        ignored: []
      }
    });
    await context.finish(input.attemptId);
  }
  let job = await context.service.state.load(context.job.id);
  expect(job.units["registry:merge"]!.status).toBe("pending");
  const brief = await queryDecomposition(
    job,
    context.root,
    context.service.reader,
    { kind: "brief", unitIds: ["registry:merge"] }
  );
  expect(brief.content).toContain("以下 1 个候选簇");
  const { input } = await context.open("registry", ["registry:merge"]);
  await context.submit("registry:merge", input.attemptId, {
    kind: "registry-plan",
    plan: { groups: [{ refs: ["c122", "c1"], name: "铃铛客" }], ignored: [] }
  });
  job = await context.service.state.load(context.job.id);
  const merged = await context.service.reader.record(job, "registry:merge");
  if (merged.data.kind !== "registry") throw new Error("名册记录无效。");
  expect(merged.data.registry.characters).toHaveLength(181);
  expect(
    merged.data.registry.characters.find(({ name }) => name === "铃铛客")
  ).toMatchObject({
    aliases: ["铃铛"],
    tier: "major_supporting",
    chunkCount: 2
  });
});
