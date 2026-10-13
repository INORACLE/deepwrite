import type { LongWorkspaceImpactConfirmation } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { longImpactSummary } from "./longImpactSummary";

const titles = {
  plot: {
    arcs: [
      { id: "arc_old", title: "码头的秘密" },
      { id: "arc_new", title: "失踪者的来信" }
    ]
  }
};
function binding(
  before: string | null,
  after: string | null
): LongWorkspaceImpactConfirmation {
  return {
    impact: {
      createdEntityIds: [],
      updatedEntityIds: ["chapter_one"],
      deletedEntityIds: [],
      createdFileIds: [],
      deletedFileIds: [],
      documentWriteProposalIds: []
    },
    entityChanges: [
      {
        kind: "chapter-card",
        id: "chapter_one",
        action: "update",
        before: {
          id: "chapter_one",
          title: "第一章",
          volumeId: "volume_one",
          narrativeOrder: 1,
          primaryArcId: before
        },
        after: {
          id: "chapter_one",
          title: "第一章",
          volumeId: "volume_one",
          narrativeOrder: 1,
          primaryArcId: after
        }
      }
    ],
    relationshipChanges: [],
    fileIntents: [],
    ledgerRecordEdits: []
  };
}

describe("concise long impact summaries", () => {
  it.each([
    [
      "arc_old",
      "arc_new",
      "将章卡「第一章」从「码头的秘密」改绑到「失踪者的来信」。"
    ],
    [null, "arc_new", "将章卡「第一章」关联到剧情点「失踪者的来信」。"],
    ["arc_old", null, "解除章卡「第一章」与剧情点「码头的秘密」的关联。"]
  ])(
    "describes %s to %s in one sentence without internal ids",
    (before, after, expected) => {
      const summary = longImpactSummary(binding(before, after), titles);
      expect(summary).toBe(expected);
      expect(summary).not.toMatch(/chapter_|arc_|relation_/u);
      expect(summary.match(/。/gu)).toHaveLength(1);
    }
  );

  it("uses a readable fallback for historical proposals whose book is not loaded", () => {
    expect(longImpactSummary(binding("arc_old", "arc_new"))).toBe(
      "调整章卡「第一章」的主剧情点关联。"
    );
  });

  it("keeps file deletion visible without displaying internal paths", () => {
    const confirmation = binding("arc_old", "arc_new");
    confirmation.fileIntents.push({
      action: "delete",
      reason: "Delete document",
      file: {
        id: "file_internal",
        path: "long/internal.md",
        updatedAt: "2026-10-12T00:00:00.000Z"
      }
    });
    const summary = longImpactSummary(confirmation, titles);
    expect(summary).toBe("更新 1 项内容，删除 1 个文档。");
    expect(summary).not.toMatch(/file_internal|internal\.md|chapter_|arc_/u);
  });
});
