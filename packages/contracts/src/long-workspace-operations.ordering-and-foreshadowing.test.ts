import type { LongWorkspaceOperation } from "./long-workspace-operations.test-support";
import {
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  applyPreviewedLongWorkspaceOperations,
  committedAnchorWorkspace,
  committedWorkspace,
  describe,
  expect,
  expectOperationError,
  it,
  later,
  longLedgerCommitFileId,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: ordering-and-foreshadowing", () => {
  it("requires an exact preview impact for cascading deletion", () => {
    const source = workspace();
    const plan = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "arc.delete", id: "arc_letter" }]
    });
    const preview = previewLongWorkspaceOperations(source, plan);

    expect(preview.impact.deletedEntityIds).toEqual(["arc_letter"]);
    expect(preview.impact.updatedEntityIds).toEqual(
      expect.arrayContaining(["chapter_one", "chapter_two", "event_letter"])
    );
    expect(preview.impact.updatedEntityIds).toContain("event_letter");
    expect(preview.impact.deletedFileIds).toHaveLength(0);
    expect(
      preview.entityChanges.find(({ id }) => id === "arc_letter")
    ).toMatchObject({
      kind: "arc",
      action: "delete",
      before: expect.objectContaining({ title: "来信之谜" }),
      after: null
    });
    expect(
      preview.entityChanges.find(({ id }) => id === "event_letter")
    ).toMatchObject({
      kind: "story-event",
      action: "update",
      before: expect.objectContaining({ arcIds: ["arc_letter"] }),
      after: expect.objectContaining({ arcIds: [] })
    });
    expect(
      preview.entityChanges.find(({ id }) => id === "chapter_one")
    ).toMatchObject({
      kind: "chapter-card",
      action: "update",
      before: expect.objectContaining({ primaryArcId: "arc_letter" }),
      after: expect.objectContaining({ primaryArcId: null })
    });
    const applied = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        ...plan,
        expectedImpact: preview.confirmation
      })
    );
    expect(applied.snapshot.plot.chapterCards).toHaveLength(2);
    expect(
      applied.snapshot.plot.chapterCards.every(
        ({ primaryArcId }) => primaryArcId === null
      )
    ).toBe(true);
    expect(applied.snapshot.chapters).toHaveLength(2);

    const staleImpact = structuredClone(preview.confirmation);
    staleImpact.impact.deletedEntityIds = [];
    expectOperationError(
      () =>
        applyLongWorkspaceOperations(
          source,
          LongWorkspaceOperationBatchSchema.parse({
            ...plan,
            expectedImpact: staleImpact
          })
        ),
      "impact_mismatch"
    );

    const result = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        ...plan,
        expectedImpact: preview.confirmation
      })
    );
    expect(result.snapshot.plot.arcs).toEqual([]);
    expect(result.snapshot.plot.chapterCards).toHaveLength(2);
    expect(
      result.snapshot.plot.chapterCards.every(
        ({ primaryArcId }) => primaryArcId === null
      )
    ).toBe(true);
    expect(result.snapshot.plot.storyEvents[0]?.arcIds).toEqual([]);
    expect(result.fileIntents).toEqual([]);
  });

  it("reports implicit order shifts and omits no-op metadata updates", () => {
    const source = workspace();
    const deletion = previewLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "chapter.delete",
          id: "chapter_one"
        }
      ]
    });
    expect(deletion.impact.deletedEntityIds).toContain("chapter_one");
    expect(deletion.impact.updatedEntityIds).toContain("chapter_two");
    expect(
      deletion.entityChanges.find(({ id }) => id === "chapter_two")
    ).toMatchObject({
      action: "update",
      before: expect.objectContaining({ narrativeOrder: 2 }),
      after: expect.objectContaining({ narrativeOrder: 1 })
    });

    const noOp = previewLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "arc.update",
          id: "arc_letter",
          patch: { title: "来信之谜" }
        }
      ]
    });
    expect(noOp.impact.updatedEntityIds).not.toContain("arc_letter");
    expect(noOp.entityChanges).toEqual([]);
  });

  it("pins recorded chapters in narrative order but still cascades their deletion", () => {
    const source = committedWorkspace();
    expectOperationError(
      () =>
        applyLongWorkspaceOperations(source, {
          updatedAt: later,
          operations: [
            {
              type: "chapter.reorder",
              volumeId: "volume_one",
              orderedIds: ["chapter_two", "chapter_one"]
            }
          ]
        }),
      "recorded_chapter_order"
    );

    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "chapter.delete", id: "chapter_one" }]
    });
    const preview = previewLongWorkspaceOperations(source, batch);
    const deleted = applyLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(
      deleted.snapshot.plot.chapterCards.some(({ id }) => id === "chapter_one")
    ).toBe(false);
    expect(deleted.snapshot.ledger.commits).toEqual([]);
    expect(
      deleted.fileIntents.some(
        ({ action, file: target }) =>
          action === "delete" &&
          target.id === longLedgerCommitFileId("commit_first")
      )
    ).toBe(true);
  });

  it("allows structure changes around recorded anchors", () => {
    const source = committedWorkspace();
    const result = applyPreviewedLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "volume.create",
          volume: {
            id: "volume_prologue",
            title: "序卷",
            summary: "",
            order: 1
          }
        },
        {
          type: "volume.reorder",
          orderedIds: ["volume_prologue", "volume_one"]
        },
        {
          type: "chapter.move",
          id: "chapter_one",
          toVolumeId: "volume_prologue",
          toPrimaryArcId: null
        }
      ]
    });
    expect(
      result.snapshot.plot.chapterCards.find(({ id }) => id === "chapter_one")
    ).toMatchObject({
      volumeId: "volume_prologue",
      primaryArcId: null
    });
    expect(result.snapshot.ledger.commits[0]?.chapterCardId).toBe(
      "chapter_one"
    );
  });

  it("keeps the uncommitted suffix editable after every committed anchor", () => {
    const allowed: Array<{
      label: string;
      operation: LongWorkspaceOperation;
    }> = [
      {
        label: "append volume",
        operation: {
          type: "volume.create",
          volume: {
            id: "volume_appended",
            title: "追加卷",
            order: 99,
            summary: ""
          }
        }
      },
      {
        label: "edit committed arc planning text",
        operation: {
          type: "arc.update",
          id: "arc_letter",
          patch: { outline: "只调整规划文本，不改变结构锚点。" }
        }
      },
      {
        label: "append arc",
        operation: {
          type: "arc.create",
          arc: {
            id: "arc_appended",
            volumeId: "volume_one",
            title: "追加弧",
            order: 99,
            outline: ""
          }
        }
      },
      {
        label: "move arc to suffix",
        operation: {
          type: "arc.move",
          id: "arc_movable",
          toVolumeId: "volume_one"
        }
      },
      {
        label: "append event",
        operation: {
          type: "event.create",
          event: {
            id: "event_appended",
            title: "追加事件",
            summary: "",
            timeMode: "sequence",
            timeLabel: "",
            storyOrder: 99,
            location: "",
            arcIds: ["arc_tail_a"],
            characterIds: []
          }
        }
      },
      {
        label: "create placement in future chapter",
        operation: {
          type: "placement.create",
          placement: {
            id: "placement_future",
            eventId: "event_tail_a",
            chapterCardId: "chapter_two",
            orderInChapter: 99,
            mode: "scene",
            disclosure: "hint",
            writingPrompt: "",
            status: "planned",
            commitId: null
          }
        }
      },
      {
        label: "append beat",
        operation: {
          type: "foreshadowingBeat.create",
          threadId: "foreshadow_letter",
          beat: {
            id: "beat_appended",
            type: "aftermath",
            order: 99,
            eventId: "event_tail_a",
            placementId: null,
            chapterCardId: "chapter_two",
            plannedScope: "",
            note: "",
            status: "planned",
            commitId: null
          }
        }
      },
      {
        label: "connect committed event to future event",
        operation: {
          type: "connection.create",
          connection: {
            id: "connection_future",
            sourceEventId: "event_letter",
            targetEventId: "event_tail_a",
            type: "enables",
            note: ""
          }
        }
      },
      {
        label: "reorder volume suffix",
        operation: {
          type: "volume.reorder",
          orderedIds: [
            "volume_setup",
            "volume_one",
            "volume_tail_b",
            "volume_tail_a"
          ]
        }
      },
      {
        label: "reorder arc suffix",
        operation: {
          type: "arc.reorder",
          volumeId: "volume_one",
          orderedIds: ["arc_setup", "arc_letter", "arc_tail_b", "arc_tail_a"]
        }
      },
      {
        label: "reorder event suffix",
        operation: {
          type: "event.reorder",
          orderedIds: [
            "event_setup",
            "event_letter",
            "event_committed_second",
            "event_tail_b",
            "event_tail_a"
          ]
        }
      },
      {
        label: "reorder beat suffix",
        operation: {
          type: "foreshadowingBeat.reorder",
          threadId: "foreshadow_letter",
          orderedIds: [
            "beat_setup",
            "beat_letter",
            "beat_committed_second",
            "beat_tail_b",
            "beat_tail_a"
          ]
        }
      },
      {
        label: "reorder thread suffix",
        operation: {
          type: "foreshadowing.reorder",
          orderedIds: [
            "foreshadow_setup",
            "foreshadow_letter",
            "foreshadow_tail_b",
            "foreshadow_tail_a"
          ]
        }
      }
    ];

    for (const { label, operation } of allowed) {
      const source = committedAnchorWorkspace();
      expect(
        () =>
          applyPreviewedLongWorkspaceOperations(source, {
            updatedAt: later,
            operations: [operation]
          }),
        label
      ).not.toThrow();
    }
  });

  it("requires new foreshadowing threads to start planned", () => {
    const source = workspace();
    expectOperationError(
      () =>
        applyLongWorkspaceOperations(source, {
          updatedAt: later,
          operations: [
            {
              type: "foreshadowing.create",
              thread: {
                id: "foreshadow_invalid",
                title: "错误初始状态",
                coreQuestion: "",
                truthEventId: null,
                expectedReaderEffect: "",
                status: "abandoned",
                beats: []
              }
            }
          ]
        }),
      "invalid_reference"
    );
  });

  it("creates, refines, and cascades typed foreshadowing planning anchors", () => {
    const source = workspace();
    const created = applyLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "foreshadowing.create",
          thread: {
            id: "foreshadow_identity",
            title: "寄信人身份",
            coreQuestion: "寄信人究竟是谁？",
            hiddenTruth: "寄信人是林岚失踪的兄长。",
            plannedSpan: "cross_volume",
            truthEventId: null,
            expectedReaderEffect: "先怀疑管家，再回看兄长留下的暗号。",
            status: "planned",
            beats: []
          }
        },
        {
          type: "foreshadowingBeat.create",
          threadId: "foreshadow_identity",
          beat: {
            id: "beat_identity_plant",
            type: "plant",
            order: 1,
            volumeId: "volume_one",
            arcId: null,
            eventId: null,
            placementId: null,
            chapterCardId: null,
            plannedScope: "",
            note: "卷内待选择具体剧情点。",
            status: "planned",
            commitId: null
          }
        }
      ]
    });
    expect(created.snapshot.plot.foreshadowing[0]).toMatchObject({
      hiddenTruth: "寄信人是林岚失踪的兄长。",
      plannedSpan: "cross_volume",
      beats: [{ volumeId: "volume_one", arcId: null }]
    });

    const refined = applyPreviewedLongWorkspaceOperations(created.snapshot, {
      updatedAt: later,
      operations: [
        {
          type: "foreshadowingBeat.update",
          id: "beat_identity_plant",
          patch: {
            volumeId: null,
            arcId: "arc_letter",
            note: "已经细化到“来信之谜”剧情点。"
          }
        }
      ]
    });
    expect(refined.snapshot.plot.foreshadowing[0]!.beats[0]).toMatchObject({
      volumeId: null,
      arcId: "arc_letter",
      note: "已经细化到“来信之谜”剧情点。"
    });

    expectOperationError(
      () =>
        applyLongWorkspaceOperations(refined.snapshot, {
          updatedAt: later,
          operations: [
            {
              type: "arc.delete",
              id: "arc_letter"
            }
          ]
        }),
      "impact_mismatch"
    );

    const deletePlan = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [
        {
          type: "arc.delete",
          id: "arc_letter"
        }
      ]
    });
    const deletePreview = previewLongWorkspaceOperations(
      refined.snapshot,
      deletePlan
    );
    expect(deletePreview.impact.deletedEntityIds).not.toContain(
      "beat_identity_plant"
    );
    const deleted = applyLongWorkspaceOperations(
      refined.snapshot,
      LongWorkspaceOperationBatchSchema.parse({
        ...deletePlan,
        expectedImpact: deletePreview.confirmation
      })
    );
    expect(deleted.snapshot.plot.foreshadowing[0]!.beats).toEqual([
      expect.objectContaining({
        id: "beat_identity_plant",
        arcId: null,
        volumeId: null,
        plannedScope: "原关联对象已删除，待重新指定锚点。"
      })
    ]);
  });
});
