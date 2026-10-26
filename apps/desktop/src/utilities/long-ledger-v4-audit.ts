import {
  longLedgerRecordCheckpointChapterId,
  type LongLedgerCommitIndexEntry,
  type LongLedgerCommitRecord,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";

export class LongLedgerAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongLedgerAuditError";
  }
}

/**
 * Text-file records keep the stable identities of checkpoint continuity files.
 * Audits do not pin content; checkpoint edit permissions are checked on writes.
 */
export function assertLongV4LedgerFileAudit(
  index: LongWorkspaceIndexSnapshot,
  entry: LongLedgerCommitIndexEntry,
  record: LongLedgerCommitRecord,
  _continuityFileContents?: ReadonlyMap<string, string>
): void {
  if (record.schemaVersion !== 4 && record.schemaVersion !== 5) return;
  const checkpointChapterCardId = longLedgerRecordCheckpointChapterId(record);
  const chapter = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === checkpointChapterCardId
  );
  if (!chapter) {
    throw new LongLedgerAuditError(
      record.schemaVersion === 4
        ? `v4 连续性账本引用了不存在的章节：${record.chapterCardId}。`
        : `v5 批量连续性账本引用了不存在的检查点章节：${checkpointChapterCardId}。`
    );
  }

  const currentReferences = [
    chapter.characterState,
    chapter.handoff,
    chapter.foreshadowingChanges,
    ...(chapter.worldReveals ? [chapter.worldReveals] : []),
    ...chapter.characterContinuity.flatMap((continuity) => [
      continuity.currentState,
      continuity.history
    ])
  ];
  const currentById = new Map(
    currentReferences.map((reference) => [reference.id, reference] as const)
  );
  const auditedById = new Map(
    record.continuityFiles.map((file) => [file.fileId, file] as const)
  );
  const requiredFileIds = [
    chapter.characterState.id,
    chapter.handoff.id,
    ...(entry.foreshadowingBeatIds.length > 0
      ? [chapter.foreshadowingChanges.id]
      : [])
  ];
  const invalid =
    auditedById.size !== record.continuityFiles.length ||
    requiredFileIds.some((fileId) => !auditedById.has(fileId)) ||
    record.continuityFiles.some((audited) => {
      const current = currentById.get(audited.fileId);
      return !current || current.path !== audited.path;
    });
  if (invalid) {
    throw new LongLedgerAuditError(
      record.schemaVersion === 4
        ? `v4 连续性账本的文件清单与章节索引不一致：${record.id}。`
        : `v5 批量连续性账本的文件清单与检查点章节索引不一致：${record.id}。`
    );
  }
}
