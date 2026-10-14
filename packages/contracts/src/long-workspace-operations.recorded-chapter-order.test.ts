import {
  createLongChapterPrimaryArcOperation,
  longVolumeChapterOrderMovesRecordedChapters
} from "./index";
import type { LongWorkspaceOperation } from "./long-workspace-operations.test-support";
import {
  LongWorkspaceIndexSnapshotSchema,
  applyPreviewedLongWorkspaceOperations,
  chapterFiles,
  committedWorkspace,
  describe,
  expect,
  expectOperationError,
  it,
  later
} from "./long-workspace-operations.test-support";

/** chapter_one is recorded; chapter_two and chapter_three are not. */
function recordedPrefixWorkspace() {
  const value = committedWorkspace();
  return LongWorkspaceIndexSnapshotSchema.parse({
    ...value,
    plot: {
      ...value.plot,
      arcs: [
        ...value.plot.arcs,
        {
          id: "arc_shadow",
          volumeId: "volume_one",
          title: "暗线",
          order: 2,
          outline: ""
        }
      ],
      chapterCards: [
        ...value.plot.chapterCards,
        {
          id: "chapter_three",
          volumeId: "volume_one",
          primaryArcId: "arc_letter",
          title: "暗巷",
          narrativeOrder: 3
        }
      ]
    },
    chapters: [...value.chapters, chapterFiles("chapter_three", "three")]
  });
}

function apply(operations: LongWorkspaceOperation[]) {
  return applyPreviewedLongWorkspaceOperations(recordedPrefixWorkspace(), {
    updatedAt: later,
    operations
  }).snapshot;
}

function chapterOrder(snapshot: ReturnType<typeof apply>): string[] {
  const volumes = new Map(
    snapshot.plot.volumes.map(({ id, order }) => [id, order])
  );
  return [...snapshot.plot.chapterCards]
    .sort(
      (left, right) =>
        (volumes.get(left.volumeId) ?? 0) -
          (volumes.get(right.volumeId) ?? 0) ||
        left.narrativeOrder - right.narrativeOrder
    )
    .map(({ id }) => id);
}

describe("recorded chapters keep their narrative position", () => {
  it("reorders unrecorded chapters after the recorded prefix", () => {
    const snapshot = apply([
      {
        type: "chapter.reorder",
        volumeId: "volume_one",
        orderedIds: ["chapter_one", "chapter_three", "chapter_two"]
      }
    ]);
    expect(chapterOrder(snapshot)).toEqual([
      "chapter_one",
      "chapter_three",
      "chapter_two"
    ]);
    expect(snapshot.ledger.committedThroughChapterId).toBe("chapter_one");
  });

  const rejected: Array<[string, LongWorkspaceOperation[]]> = [
    [
      "reorder recorded chapter",
      [
        {
          type: "chapter.reorder",
          volumeId: "volume_one",
          orderedIds: ["chapter_two", "chapter_one", "chapter_three"]
        }
      ]
    ],
    [
      "move unrecorded chapter before recorded chapter",
      [
        {
          type: "chapter.move",
          id: "chapter_three",
          toVolumeId: "volume_one",
          toPrimaryArcId: "arc_letter",
          beforeChapterCardId: "chapter_one"
        }
      ]
    ],
    [
      "reorder volumes across recorded chapters",
      [
        {
          type: "volume.create",
          volume: { id: "volume_two", title: "第二卷", order: 2, summary: "" }
        },
        {
          type: "chapter.move",
          id: "chapter_three",
          toVolumeId: "volume_two",
          toPrimaryArcId: null
        },
        {
          type: "volume.reorder",
          orderedIds: ["volume_two", "volume_one"]
        }
      ]
    ]
  ];
  it.each(rejected)("rejects %s", (_label, operations) => {
    expectOperationError(() => apply(operations), "recorded_chapter_order");
  });

  it("still rebinds a recorded chapter's plot point in place", () => {
    const source = recordedPrefixWorkspace();
    const move = createLongChapterPrimaryArcOperation(
      source,
      "chapter_one",
      "arc_shadow"
    );
    if (!move) throw new Error("Expected a primary arc move.");
    const snapshot = apply([move]);
    expect(chapterOrder(snapshot)).toEqual([
      "chapter_one",
      "chapter_two",
      "chapter_three"
    ]);
    expect(
      snapshot.plot.chapterCards.find(({ id }) => id === "chapter_one")
    ).toMatchObject({ primaryArcId: "arc_shadow" });
  });

  it("checks a proposed volume order before it is submitted", () => {
    const source = recordedPrefixWorkspace();
    expect(
      longVolumeChapterOrderMovesRecordedChapters(source, "volume_one", [
        "chapter_one",
        "chapter_three",
        "chapter_two"
      ])
    ).toBe(false);
    expect(
      longVolumeChapterOrderMovesRecordedChapters(source, "volume_one", [
        "chapter_three",
        "chapter_one",
        "chapter_two"
      ])
    ).toBe(true);
  });
});
