import type { LongWorkspaceIndexSnapshot } from "./index-validation";

type LongChapterFileEntry = LongWorkspaceIndexSnapshot["chapters"][number];

/** Only the newest ledger entry's checkpoint remains editable after recording. */
export function isLongChapterContinuityReadOnly(
  workspaceIndex: Pick<LongWorkspaceIndexSnapshot, "ledger">,
  chapter: Pick<LongChapterFileEntry, "chapterCardId" | "commitId">
): boolean {
  if (chapter.commitId === null) return false;
  const latest = workspaceIndex.ledger.commits.at(-1);
  return (
    latest?.id !== chapter.commitId ||
    latest.chapterCardId !== chapter.chapterCardId
  );
}

/** Resolves the newest commit's final continuity checkpoint chapter. */
export function latestCommittedContinuityChapter(
  workspaceIndex: LongWorkspaceIndexSnapshot,
  predicate: (chapter: LongChapterFileEntry) => boolean = () => true
): LongChapterFileEntry | undefined {
  const volumeOrder = new Map(
    workspaceIndex.plot.volumes.map(({ id, order }) => [id, order])
  );
  const chapterOrder = new Map(
    [...workspaceIndex.plot.chapterCards]
      .sort(
        (left, right) =>
          (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
            (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
          left.narrativeOrder - right.narrativeOrder ||
          left.id.localeCompare(right.id)
      )
      .map(({ id }, order) => [id, order])
  );
  const commits = [...workspaceIndex.ledger.commits].sort(
    (left, right) =>
      (chapterOrder.get(right.chapterCardId) ?? -1) -
        (chapterOrder.get(left.chapterCardId) ?? -1) ||
      right.sequence - left.sequence ||
      right.id.localeCompare(left.id)
  );
  for (const commit of commits) {
    const chapter = workspaceIndex.chapters.find(
      (entry) =>
        entry.chapterCardId === commit.chapterCardId &&
        entry.commitId === commit.id
    );
    if (chapter && predicate(chapter)) return chapter;
  }
  return undefined;
}
