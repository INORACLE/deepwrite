import {
  longRecordedChapterIds,
  longVolumeChapterOrderMovesRecordedChapters,
  LongWorkspaceOperationSchema,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation
} from "@deepwrite/contracts";
import type { LongFieldTarget } from "./target";

const RELOCATION_TITLES = 12;

function chapterTitles(
  index: LongWorkspaceIndexSnapshot,
  ids: readonly string[]
): string {
  const titles = new Map(
    index.plot.chapterCards.map(({ id, title }) => [id, title])
  );
  const shown = ids.slice(0, RELOCATION_TITLES).map((id) => titles.get(id));
  const more = ids.length > RELOCATION_TITLES ? "…" : "";
  return `${shown.join("、")}${more}`;
}

/**
 * Translates a volume's `meta.chapter_order` into one `chapter.reorder`.
 * Returns undefined when the requested order already matches the volume.
 */
export function volumeChapterOrderOperation(
  index: LongWorkspaceIndexSnapshot,
  target: LongFieldTarget,
  chapterOrder: readonly string[]
): { operation: LongWorkspaceOperation; relocation: string } | undefined {
  if (target.kind !== "volume") {
    throw new Error("chapter_order 只用于分卷，用来调整本卷章卡的先后顺序。");
  }
  const currentIds = index.plot.chapterCards
    .filter(({ volumeId }) => volumeId === target.id)
    .sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    )
    .map(({ id }) => id);
  const requested = new Set(chapterOrder);
  if (
    requested.size !== chapterOrder.length ||
    chapterOrder.length !== currentIds.length ||
    currentIds.some((id) => !requested.has(id))
  ) {
    throw new Error(
      `chapter_order 必须完整列出本卷全部 ${currentIds.length} 个章卡 id，且每个只出现一次；当前顺序：${currentIds.join("、")}。`
    );
  }
  if (currentIds.every((id, position) => chapterOrder[position] === id)) {
    return undefined;
  }
  if (
    longVolumeChapterOrderMovesRecordedChapters(index, target.id, chapterOrder)
  ) {
    const recorded = longRecordedChapterIds(index);
    throw new Error(
      `已写入连续性账本的章节位置固定，其他章节也不能越过它们：${chapterTitles(
        index,
        currentIds.filter((id) => recorded.has(id))
      )}。未归档章节只能在相邻的已归档章节之间调整先后。`
    );
  }
  return {
    operation: LongWorkspaceOperationSchema.parse({
      type: "chapter.reorder",
      volumeId: target.id,
      orderedIds: chapterOrder
    }),
    relocation: `章节顺序：${chapterTitles(index, currentIds)} → ${chapterTitles(
      index,
      chapterOrder
    )}`
  };
}
