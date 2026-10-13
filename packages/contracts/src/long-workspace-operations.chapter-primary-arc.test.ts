import { createLongChapterPrimaryArcOperation } from "./index";
import {
  applyPreviewedLongWorkspaceOperations,
  committedWorkspace,
  describe,
  expect,
  it,
  later,
  workspace
} from "./long-workspace-operations.test-support";

describe("chapter primary plot point changes", () => {
  it.each(["arc_next", null])(
    "rebinds to %s without moving the first chapter or changing its files and ledger",
    (arcId) => {
      const index = committedWorkspace();
      index.plot.arcs.push({
        ...index.plot.arcs[0]!,
        id: "arc_next",
        title: "下一剧情点",
        order: 2
      });
      const original = structuredClone(index);
      const operation = createLongChapterPrimaryArcOperation(
        index,
        "chapter_one",
        arcId
      );
      expect(operation).toMatchObject({ beforeChapterCardId: "chapter_two" });
      const applied = applyPreviewedLongWorkspaceOperations(index, {
        updatedAt: later,
        operations: [operation!],
        documentWrites: []
      });
      expect(applied.snapshot.plot.chapterCards.map(({ id }) => id)).toEqual(
        original.plot.chapterCards.map(({ id }) => id)
      );
      expect(
        applied.snapshot.plot.chapterCards.map(
          ({ narrativeOrder }) => narrativeOrder
        )
      ).toEqual(
        original.plot.chapterCards.map(({ narrativeOrder }) => narrativeOrder)
      );
      expect(applied.snapshot.plot.chapterCards[0]?.primaryArcId).toBe(arcId);
      expect(applied.snapshot.chapters).toEqual(original.chapters);
      expect(applied.snapshot.ledger).toEqual(original.ledger);
      expect(applied.fileIntents).toEqual([]);
      expect(index).toEqual(original);
    }
  );

  it("keeps the last chapter last and treats unchanged bindings as a no-op", () => {
    const index = workspace();
    expect(
      createLongChapterPrimaryArcOperation(index, "chapter_one", "arc_letter")
    ).toBeUndefined();
    const operation = createLongChapterPrimaryArcOperation(
      index,
      "chapter_two",
      null
    );
    expect(operation).not.toHaveProperty("beforeChapterCardId");
    const applied = applyPreviewedLongWorkspaceOperations(index, {
      updatedAt: later,
      operations: [operation!],
      documentWrites: []
    });
    expect(
      applied.snapshot.plot.chapterCards.map(
        ({ narrativeOrder }) => narrativeOrder
      )
    ).toEqual(
      index.plot.chapterCards.map(({ narrativeOrder }) => narrativeOrder)
    );
  });

  it("rejects missing chapters, missing plot points and cross-volume bindings", () => {
    const index = workspace();
    index.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    index.plot.arcs.push({
      ...index.plot.arcs[0]!,
      id: "arc_other",
      volumeId: "volume_two",
      title: "异卷剧情点"
    });
    expect(() =>
      createLongChapterPrimaryArcOperation(index, "chapter_missing", null)
    ).toThrow("does not exist");
    expect(() =>
      createLongChapterPrimaryArcOperation(index, "chapter_one", "arc_missing")
    ).toThrow("does not exist");
    expect(() =>
      createLongChapterPrimaryArcOperation(index, "chapter_one", "arc_other")
    ).toThrow("chapter volume");
  });
});
