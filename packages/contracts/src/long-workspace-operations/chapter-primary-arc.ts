import {
  LongArcIdSchema,
  LongChapterCardIdSchema,
  type LongWorkspaceIndexSnapshot
} from "../long-workspace";
import type { LongWorkspaceOperation } from "./operation-schema";

/** Rebind a chapter within its volume without changing its narrative position. */
export function createLongChapterPrimaryArcOperation(
  workspace: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  primaryArcId: string | null
): Extract<LongWorkspaceOperation, { type: "chapter.move" }> | undefined {
  const id = LongChapterCardIdSchema.parse(chapterCardId);
  const arcId = LongArcIdSchema.nullable().parse(primaryArcId);
  const chapter = workspace.plot.chapterCards.find((item) => item.id === id);
  if (!chapter) throw new Error(`Chapter card ${id} does not exist.`);
  if (arcId !== null) {
    const arc = workspace.plot.arcs.find((item) => item.id === arcId);
    if (!arc) throw new Error(`Target primary arc ${arcId} does not exist.`);
    if (arc.volumeId !== chapter.volumeId) {
      throw new Error("Target primary arc must belong to the chapter volume.");
    }
  }
  if (arcId === chapter.primaryArcId) return undefined;
  const siblings = workspace.plot.chapterCards
    .filter((item) => item.volumeId === chapter.volumeId)
    .sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    );
  const next = siblings[siblings.findIndex((item) => item.id === id) + 1];
  return {
    type: "chapter.move",
    id,
    toVolumeId: chapter.volumeId,
    toPrimaryArcId: arcId,
    ...(next ? { beforeChapterCardId: next.id } : {})
  };
}
