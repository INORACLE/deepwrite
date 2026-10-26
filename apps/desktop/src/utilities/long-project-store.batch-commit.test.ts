import {
  FIXED_NOW,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  it,
  join,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  projectTransactionContentSha256,
  readFile
} from "./long-project-store.test-support";

function chapterFiles(chapterCardId: string) {
  const storage = projectTransactionContentSha256(chapterCardId).slice(0, 32);
  const file = (id: string, path: string) =>
    createEmptyLongMarkdownFileReference(id, path, FIXED_NOW);
  return {
    chapterCardId,
    bodyStatus: "empty" as const,
    body: file(
      longChapterBodyFileId(chapterCardId),
      `long/chapters/${storage}/body.md`
    ),
    card: file(
      longChapterCardFileId(chapterCardId),
      `long/chapters/${storage}/card.md`
    ),
    characterState: file(
      longChapterCharacterStateFileId(chapterCardId),
      `long/chapters/${storage}/character-state.md`
    ),
    handoff: file(
      longChapterHandoffFileId(chapterCardId),
      `long/chapters/${storage}/handoff.md`
    ),
    foreshadowingChanges: file(
      longChapterForeshadowingChangesFileId(chapterCardId),
      longChapterContinuityFilePath(chapterCardId, "foreshadowing-changes.md")
    ),
    worldReveals: null,
    characterContinuity: [],
    commitId: null
  };
}

describe("LongProjectStore: batch continuity commits", () => {
  it("stores contiguous chapters in one record, pins their order and invalidates the batch together", async () => {
    const { projectStore, created } = await createFixture("batch-commit");
    const firstChapterId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const volumeId = created.book.workspaceIndex.plot.volumes[0]!.id;
    const secondChapterId = "chapter_batch_second";
    const secondFiles = chapterFiles(secondChapterId);

    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "chapter.create",
            chapterCard: {
              id: secondChapterId,
              volumeId,
              primaryArcId: null,
              title: "批次第二章",
              narrativeOrder: 2
            },
            files: secondFiles
          }
        ],
        documentWrites: []
      }
    });

    const opened = await projectStore.openBook(created.projectDirectory);
    const firstFiles = opened.book.workspaceIndex.chapters.find(
      ({ chapterCardId }) => chapterCardId === firstChapterId
    )!;
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: firstFiles.body.id,
      content: "第一章正文已写完，但不生成单独连续性文件。"
    });
    await projectStore.writeChapter(created.projectDirectory, {
      chapterCardId: secondChapterId,
      body: { content: "第二章正文承接并结束这一批。" },
      characterState: { content: "两章结束后的汇总章末状态。" },
      handoff: { content: "下一章从整批结束后的状态继续。" }
    });

    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      {
        mode: "text_files_batch",
        chapterCardIds: [firstChapterId, secondChapterId],
        checkpointChapterCardId: secondChapterId,
        foreshadowingBeatDecisions: {},
        commitMessage: "一次归档连续写完的两章"
      }
    );
    expect(committed.record).toMatchObject({
      schemaVersion: 5,
      chapterCardId: secondChapterId,
      chapterCardIds: [firstChapterId, secondChapterId],
      checkpointChapterCardId: secondChapterId,
      committedThroughChapterId: secondChapterId
    });

    const afterCommit = await projectStore.openBook(created.projectDirectory);
    expect(afterCommit.book.workspaceIndex.ledger.commits).toHaveLength(1);
    expect(afterCommit.book.workspaceIndex.ledger.commits[0]).toMatchObject({
      id: committed.record.id,
      mode: "text_files_batch",
      chapterCardIds: [firstChapterId, secondChapterId],
      checkpointChapterCardId: secondChapterId
    });
    expect(
      afterCommit.book.workspaceIndex.chapters.map(
        ({ chapterCardId, commitId }) => ({ chapterCardId, commitId })
      )
    ).toEqual([
      { chapterCardId: firstChapterId, commitId: committed.record.id },
      { chapterCardId: secondChapterId, commitId: committed.record.id }
    ]);
    expect(
      committed.record.continuityFiles.map(({ fileId }) => fileId)
    ).toEqual([secondFiles.characterState.id, secondFiles.handoff.id]);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: firstFiles.characterState.id
      })
    ).resolves.toMatchObject({ content: "" });

    await expect(
      projectStore.writeDocument(created.projectDirectory, {
        fileId: firstFiles.characterState.id,
        content: "不能补写批次中间的历史章节。"
      })
    ).rejects.toMatchObject({ code: "historical_continuity_readonly" });
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: secondFiles.characterState.id,
      content: "归档后继续修订末章汇总。"
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: secondFiles.characterState.id
      })
    ).resolves.toMatchObject({ content: "归档后继续修订末章汇总。" });

    const recordPath = join(
      created.projectDirectory,
      afterCommit.book.workspaceIndex.ledger.commits[0]!.recordFile.path
    );
    expect(await readFile(recordPath, "utf8")).toContain('"schemaVersion": 5');

    const reorderBatch = {
      updatedAt: FIXED_NOW,
      operations: [
        {
          type: "chapter.reorder" as const,
          volumeId,
          orderedIds: [secondChapterId, firstChapterId]
        }
      ],
      documentWrites: []
    };
    await expect(
      projectStore.previewWorkspaceOperations(
        created.projectDirectory,
        reorderBatch
      )
    ).rejects.toMatchObject({ code: "recorded_chapter_order" });

    const deletionBatch = {
      updatedAt: FIXED_NOW,
      operations: [{ type: "chapter.delete" as const, id: firstChapterId }],
      documentWrites: []
    };
    const preview = await projectStore.previewWorkspaceOperations(
      created.projectDirectory,
      deletionBatch
    );
    const deleted = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          ...deletionBatch,
          expectedImpact: preview.confirmation
        }
      }
    );
    expect(deleted.book.workspaceIndex.ledger.commits).toEqual([]);
    expect(
      deleted.book.workspaceIndex.ledger.committedThroughChapterId
    ).toBeNull();
    expect(deleted.book.workspaceIndex.chapters).toEqual([
      expect.objectContaining({
        chapterCardId: secondChapterId,
        commitId: null
      })
    ]);
    await expect(readFile(recordPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
