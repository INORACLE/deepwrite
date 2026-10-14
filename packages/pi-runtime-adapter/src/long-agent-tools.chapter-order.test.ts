import {
  applyLongWorkspaceOperations,
  previewLongWorkspaceOperations
} from "@deepwrite/contracts";
import {
  Check,
  committedFixtureIndex,
  describe,
  documentExecutor,
  expect,
  it,
  longTools,
  resultText,
  toolByName,
  twoWrittenChaptersIndex
} from "./long-agent-tools.test-support";

function editTool(index = twoWrittenChaptersIndex()) {
  return toolByName(
    longTools({ executor: documentExecutor(index), index }),
    "edit"
  );
}

function recordedFirstChapterIndex() {
  const index = twoWrittenChaptersIndex();
  const committed = committedFixtureIndex();
  index.chapters[0] = committed.chapters[0]!;
  index.ledger = committed.ledger;
  return index;
}

describe("volume chapter_order metadata", () => {
  it("proposes one chapter.reorder that moves cards with their files", async () => {
    const index = twoWrittenChaptersIndex();
    const original = structuredClone(index);
    const edit = editTool(index);
    const params = {
      id: "volume_one",
      meta: { chapter_order: ["chapter_two", "chapter_one"] },
      summary: "调整章节顺序"
    };
    expect(Check(edit.parameters, params)).toBe(true);
    const result = await edit.execute("reorder", params);
    if (result.details?.kind !== "long-mutation-proposal")
      throw new Error("Expected a mutation proposal");
    expect(result.details.batch.operations).toEqual([
      {
        type: "chapter.reorder",
        volumeId: "volume_one",
        orderedIds: ["chapter_two", "chapter_one"]
      }
    ]);
    expect(result.details.summary).toContain(
      "章节顺序：第一章、第二章 → 第二章、第一章"
    );
    expect(index).toEqual(original);
    const applied = applyLongWorkspaceOperations(index, {
      ...result.details.batch,
      expectedImpact: previewLongWorkspaceOperations(
        index,
        result.details.batch
      ).confirmation
    }).snapshot;
    expect(
      Object.fromEntries(
        applied.plot.chapterCards.map(({ id, narrativeOrder }) => [
          id,
          narrativeOrder
        ])
      )
    ).toEqual({ chapter_one: 2, chapter_two: 1 });
    expect(applied.chapters).toEqual(original.chapters);
  });

  it("combines a volume title change with the reorder", async () => {
    const result = await editTool().execute("rename-and-reorder", {
      id: "volume_one",
      meta: { title: "新卷名", chapter_order: ["chapter_two", "chapter_one"] }
    });
    if (result.details?.kind !== "long-mutation-proposal")
      throw new Error("Expected a mutation proposal");
    const operations: Array<{ type: string }> = result.details.batch.operations;
    expect(operations.map(({ type }) => type)).toEqual([
      "volume.update",
      "chapter.reorder"
    ]);
  });

  it("reports an unchanged order without forming a proposal", async () => {
    const result = await editTool().execute("same", {
      id: "volume_one",
      meta: { chapter_order: ["chapter_one", "chapter_two"] }
    });
    expect(result.details).toEqual({ kind: "none" });
    expect(resultText(result)).toContain("章节顺序未变化");
  });

  it("requires every chapter of the volume exactly once", async () => {
    await expect(
      editTool().execute("partial", {
        id: "volume_one",
        meta: { chapter_order: ["chapter_two"] }
      })
    ).rejects.toThrow("必须完整列出本卷全部 2 个章卡 id");
  });

  it("keeps recorded chapters in place", async () => {
    await expect(
      editTool(recordedFirstChapterIndex()).execute("recorded", {
        id: "volume_one",
        meta: { chapter_order: ["chapter_two", "chapter_one"] }
      })
    ).rejects.toThrow("已写入连续性账本的章节位置固定");
  });

  it("only accepts chapter_order on volumes", async () => {
    const edit = editTool();
    await expect(
      edit.execute("arc", {
        id: "arc_one",
        meta: { chapter_order: ["chapter_two", "chapter_one"] }
      })
    ).rejects.toThrow("chapter_order 只用于分卷");
    await expect(
      edit.execute("chapter", {
        id: "chapter_one",
        meta: { chapter_order: ["chapter_two", "chapter_one"] }
      })
    ).rejects.toThrow("meta 只接受");
  });
});
