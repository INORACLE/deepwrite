import { describe, expect, it } from "vitest";
import {
  applyLongWorkspaceOperations,
  createLongChapterPrimaryArcOperation,
  longWorkspaceImpactIsDestructive,
  longWorkspaceOperationsRequireImpactConfirmation,
  previewLongWorkspaceOperations,
  type LongWorkspaceDestructiveImpact
} from "./long-workspace-operations";
import {
  committedForeshadowingWorkspace,
  later,
  workspace
} from "./long-workspace-operations.test-support";

const emptyImpact: LongWorkspaceDestructiveImpact = {
  entityChanges: [],
  relationshipChanges: [],
  fileIntents: [],
  ledgerRecordEdits: []
};

describe("long workspace destructive impact policy", () => {
  it.each(["arc_next", null])(
    "allows a same-volume binding change to %s, including planning beat corrections",
    (arcId) => {
      const index = committedForeshadowingWorkspace();
      index.plot.arcs.push({
        ...index.plot.arcs[0]!,
        id: "arc_next",
        title: "下一剧情点",
        order: 2
      });
      index.plot.foreshadowing[0]!.beats[0]!.arcId = "arc_letter";
      const original = structuredClone(index);
      const operation = createLongChapterPrimaryArcOperation(
        index,
        "chapter_one",
        arcId
      )!;
      const batch = {
        updatedAt: later,
        operations: [operation],
        documentWrites: []
      };
      const preview = previewLongWorkspaceOperations(index, batch);
      expect(
        preview.relationshipChanges.some(({ action }) => action === "delete")
      ).toBe(true);
      expect(
        longWorkspaceOperationsRequireImpactConfirmation(
          batch.operations,
          preview
        )
      ).toBe(false);
      const applied = applyLongWorkspaceOperations(index, batch);
      expect(applied.snapshot.plot.chapterCards[0]?.primaryArcId).toBe(arcId);
      expect(
        applied.snapshot.plot.chapterCards.map(
          ({ narrativeOrder }) => narrativeOrder
        )
      ).toEqual(
        original.plot.chapterCards.map(({ narrativeOrder }) => narrativeOrder)
      );
      expect(applied.snapshot.chapters).toEqual(original.chapters);
      expect(applied.snapshot.ledger).toEqual(original.ledger);
      expect(
        applied.snapshot.plot.foreshadowing[0]?.beats[0]?.arcId
      ).toBeNull();
      expect(index).toEqual(original);
    }
  );

  it("retains manual review for reordered chapters, volume changes, other unlinking and file removal", () => {
    const index = workspace();
    const operation = createLongChapterPrimaryArcOperation(
      index,
      "chapter_one",
      null
    )!;
    const preview = previewLongWorkspaceOperations(index, {
      updatedAt: later,
      operations: [operation],
      documentWrites: []
    });
    const chapter = preview.entityChanges.find(
      ({ kind }) => kind === "chapter-card"
    );
    if (!chapter || !chapter.after) throw new Error("Missing chapter impact");
    for (const patch of [{ narrativeOrder: 2 }, { volumeId: "volume_other" }]) {
      const impact = {
        ...preview,
        entityChanges: [{ ...chapter, after: { ...chapter.after, ...patch } }]
      };
      expect(
        longWorkspaceOperationsRequireImpactConfirmation([operation], impact)
      ).toBe(true);
    }
    const impact = {
      ...preview,
      relationshipChanges: [
        ...preview.relationshipChanges,
        {
          kind: "story-event-character" as const,
          id: "relation_unrelated",
          action: "delete" as const,
          before: { sourceId: "event_letter", targetId: "character_alice" },
          after: null
        }
      ]
    };
    expect(
      longWorkspaceOperationsRequireImpactConfirmation([operation], impact)
    ).toBe(true);
    expect(
      longWorkspaceOperationsRequireImpactConfirmation([operation], {
        ...preview,
        fileIntents: [
          {
            action: "delete",
            file: index.chapters[0]!.body,
            reason: "Remove manuscript"
          }
        ]
      })
    ).toBe(true);
    expect(
      longWorkspaceOperationsRequireImpactConfirmation(
        [operation, { type: "chapter.delete" }],
        preview
      )
    ).toBe(true);
  });

  it("keeps explicit deletes gated even if a handler reports empty impact", () => {
    expect(longWorkspaceImpactIsDestructive(emptyImpact)).toBe(false);
    expect(
      longWorkspaceOperationsRequireImpactConfirmation(
        [{ type: "character.delete" }],
        emptyImpact
      )
    ).toBe(true);
  });

  it("gates destructive effects hidden behind a non-delete command name", () => {
    const conversionImpact: LongWorkspaceDestructiveImpact = {
      ...emptyImpact,
      fileIntents: [
        {
          action: "delete",
          file: {
            id: "longfile_world_rules",
            path: "long/worldbuilding/rules.md",
            updatedAt: "2026-07-26T12:00:00.000Z"
          },
          reason: "Convert worldbuilding category"
        }
      ]
    };

    expect(
      longWorkspaceOperationsRequireImpactConfirmation(
        [{ type: "worldbuilding.update" }],
        conversionImpact
      )
    ).toBe(true);
  });
});
