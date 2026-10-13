import {
  createLongChapterPrimaryArcOperation,
  LongWorkspaceOperationSchema,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation
} from "@deepwrite/contracts";

export function chapterMetadataOperations(
  index: LongWorkspaceIndexSnapshot,
  id: string,
  meta: Record<string, unknown>
): { operations: LongWorkspaceOperation[]; relocation?: string } {
  const chapter = index.plot.chapterCards.find((item) => item.id === id);
  if (!chapter) throw new Error(`章卡 ${id} 不存在。`);
  const allowed = ["title", "primary_arc_id"];
  if (Object.keys(meta).some((key) => !allowed.includes(key))) {
    throw new Error(`章卡的 meta 只接受：${allowed.join("、")}。`);
  }
  const operations: LongWorkspaceOperation[] = [];
  if (meta.title !== undefined) {
    const update = LongWorkspaceOperationSchema.parse({
      type: "chapter.update",
      id,
      patch: { title: meta.title }
    });
    if (
      update.type === "chapter.update" &&
      update.patch.title !== chapter.title
    )
      operations.push(update);
  }
  if (meta.primary_arc_id === undefined) return { operations };
  const move = createLongChapterPrimaryArcOperation(
    index,
    id,
    meta.primary_arc_id as string | null
  );
  if (!move) return { operations };
  operations.push(move);
  const arcTitle = (arcId: string | null) =>
    index.plot.arcs.find((item) => item.id === arcId)?.title ?? "未关联";
  return {
    operations,
    relocation: `主剧情点：${arcTitle(chapter.primaryArcId)} → ${arcTitle(move.toPrimaryArcId)}`
  };
}
