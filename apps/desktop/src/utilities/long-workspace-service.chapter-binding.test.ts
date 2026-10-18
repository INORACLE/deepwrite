import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createLongChapterPrimaryArcOperation,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { LongWorkspaceService } from "./long-workspace-service";

// Real project transactions need a disk integration budget on Windows runners.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe("persisted chapter plot point changes", () => {
  it("saves reviewed rebinding and unlinking across restarts while preserving Markdown", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-chapter-binding-"))
    );
    try {
      const userDataPath = join(root, "user-data");
      const service = new LongWorkspaceService({ userDataPath });
      const { book } = await service.create(root, {
        title: "章节关联测试",
        genre: "悬疑"
      });
      const original = book.workspaceIndex;
      const card = original.plot.chapterCards[0]!;
      const files = original.chapters[0]!;
      await service.writeDocument({
        bookId: book.id,
        fileId: files.card.id,
        content: "章卡计划。"
      });
      await service.writeDocument({
        bookId: book.id,
        fileId: files.body.id,
        content: "这一章的正文。"
      });
      await service.applyOperations({
        bookId: book.id,
        batch: {
          updatedAt: new Date().toISOString(),
          operations: [
            {
              type: "arc.create",
              arc: {
                id: "arc_other",
                volumeId: card.volumeId,
                title: "新的剧情点",
                order: 2,
                summary: "",
                outline: ""
              }
            }
          ],
          documentWrites: []
        }
      });
      for (const primaryArcId of ["arc_other", null]) {
        const index = (await service.getWorkspaceIndex({ bookId: book.id }))
          .workspaceIndex;
        const batch: LongWorkspaceOperationBatch = {
          updatedAt: new Date().toISOString(),
          operations: [
            createLongChapterPrimaryArcOperation(index, card.id, primaryArcId)!
          ],
          documentWrites: []
        };
        const preview = await service.previewOperations({
          bookId: book.id,
          batch
        });
        // Preparing the change must never save it before review.
        expect(
          (await service.getWorkspaceIndex({ bookId: book.id })).workspaceIndex
            .plot.chapterCards[0]?.primaryArcId
        ).toBe(index.plot.chapterCards[0]?.primaryArcId);
        await service.applyOperations({
          bookId: book.id,
          batch: { ...batch, expectedImpact: preview.preview.confirmation }
        });
        const restarted = new LongWorkspaceService({ userDataPath });
        const reopened = await restarted.open({ bookId: book.id });
        expect(reopened.book.workspaceIndex.plot.chapterCards[0]).toMatchObject(
          {
            id: card.id,
            primaryArcId,
            volumeId: card.volumeId,
            narrativeOrder: card.narrativeOrder
          }
        );
        expect(reopened.book.workspaceIndex.ledger).toEqual(original.ledger);
        expect(
          (
            await restarted.readDocument({
              bookId: book.id,
              fileId: files.card.id,
              offset: 0,
              maxCharacters: 100
            })
          ).content
        ).toBe("章卡计划。");
        expect(
          (
            await restarted.readDocument({
              bookId: book.id,
              fileId: files.body.id,
              offset: 0,
              maxCharacters: 100
            })
          ).content
        ).toBe("这一章的正文。");
      }
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      });
    }
  });
});
