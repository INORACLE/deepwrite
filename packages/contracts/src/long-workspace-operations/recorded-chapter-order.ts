import type { LongWorkspaceIndexSnapshot } from "../long-workspace";
import type { LongWorkspaceOperation } from "./operation-schema";
import { operationError, orderedChapterIds } from "./state";

/** Operations that can change the narrative position of a chapter. */
export const LONG_CHAPTER_ORDER_OPERATION_TYPES: ReadonlySet<
  LongWorkspaceOperation["type"]
> = new Set(["chapter.move", "chapter.reorder", "volume.reorder"]);

export function longRecordedChapterIds(
  workspace: Pick<LongWorkspaceIndexSnapshot, "chapters">
): Set<string> {
  return new Set(
    workspace.chapters
      .filter(({ commitId }) => commitId !== null)
      .map(({ chapterCardId }) => chapterCardId)
  );
}

/**
 * Recorded chapters keep their exact slot; every other chapter keeps the gap
 * between the same recorded neighbours. Ledger records summarize the story in
 * this order, so crossing a recorded chapter would invalidate them silently.
 */
function recordedChapterSlots(
  orderedIds: readonly string[],
  recorded: ReadonlySet<string>
): Map<string, string> {
  const slots = new Map<string, string>();
  let gap = 0;
  orderedIds.forEach((id, position) => {
    if (recorded.has(id)) {
      gap += 1;
      slots.set(id, `recorded:${position}`);
    } else {
      slots.set(id, `gap:${gap}`);
    }
  });
  return slots;
}

export function longChapterOrderMovesRecordedChapters(
  recorded: ReadonlySet<string>,
  beforeIds: readonly string[],
  afterIds: readonly string[]
): boolean {
  if (recorded.size === 0) return false;
  const after = recordedChapterSlots(afterIds, recorded);
  return [...recordedChapterSlots(beforeIds, recorded)].some(
    ([id, slot]) => after.get(id) !== slot
  );
}

/** Checks one volume's proposed chapter order before a reorder is submitted. */
export function longVolumeChapterOrderMovesRecordedChapters(
  workspace: Pick<LongWorkspaceIndexSnapshot, "chapters" | "plot">,
  volumeId: string,
  orderedIds: readonly string[]
): boolean {
  const currentIds = workspace.plot.chapterCards
    .filter((chapter) => chapter.volumeId === volumeId)
    .sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    )
    .map(({ id }) => id);
  return longChapterOrderMovesRecordedChapters(
    longRecordedChapterIds(workspace),
    currentIds,
    orderedIds
  );
}

export function assertRecordedChapterOrderKept(
  workspace: LongWorkspaceIndexSnapshot,
  beforeIds: readonly string[]
): void {
  if (
    longChapterOrderMovesRecordedChapters(
      longRecordedChapterIds(workspace),
      beforeIds,
      orderedChapterIds(workspace)
    )
  ) {
    operationError(
      "recorded_chapter_order",
      "Chapters recorded in the continuity ledger keep their narrative position, and other chapters cannot move across them."
    );
  }
}
