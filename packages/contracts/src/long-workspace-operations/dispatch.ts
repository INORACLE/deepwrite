import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";
import { applyCharacterOperation } from "./apply-character";
import { applyForeshadowingOperation } from "./apply-foreshadowing";
import { applyPlotOperation } from "./apply-plot";
import { applyVolumeChapterOperation } from "./apply-volume-chapter";
import { applyWorldbuildingOperation } from "./apply-worldbuilding";
import {
  assertRecordedChapterOrderKept,
  LONG_CHAPTER_ORDER_OPERATION_TYPES
} from "./recorded-chapter-order";
import { orderedChapterIds } from "./state";

export function applyLongWorkspaceOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  if (!LONG_CHAPTER_ORDER_OPERATION_TYPES.has(operation.type)) {
    dispatchLongWorkspaceOperation(state, operation);
    return;
  }
  const before = orderedChapterIds(state.draft);
  dispatchLongWorkspaceOperation(state, operation);
  assertRecordedChapterOrderKept(state.draft, before);
}

function dispatchLongWorkspaceOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  switch (operation.type) {
    case "featureSettings.update":
    case "worldbuilding.create":
    case "worldbuilding.update":
    case "worldbuilding.delete":
    case "worldbuildingItem.create":
    case "worldbuildingItem.update":
    case "worldbuildingItem.delete":
    case "worldbuildingItem.reorder":
    case "worldbuilding.reorder":
      applyWorldbuildingOperation(state, operation);
      return;
    case "characterType.create":
    case "characterType.update":
    case "characterType.delete":
    case "characterType.reorder":
    case "character.create":
    case "character.update":
    case "character.delete":
    case "character.move":
    case "character.reorder":
      applyCharacterOperation(state, operation);
      return;
    case "volume.create":
    case "volume.update":
    case "volume.delete":
    case "volume.reorder":
    case "arc.create":
    case "arc.update":
    case "arc.delete":
    case "arc.move":
    case "arc.reorder":
    case "chapter.create":
    case "chapter.update":
    case "chapter.delete":
    case "chapter.move":
    case "chapter.reorder":
    case "chapterContinuity.worldReveals.create":
    case "chapterContinuity.worldReveals.delete":
    case "chapterContinuity.character.create":
    case "chapterContinuity.character.delete":
      applyVolumeChapterOperation(state, operation);
      return;
    case "event.create":
    case "event.update":
    case "event.delete":
    case "event.reorder":
    case "storyPlot.create":
    case "storyPlot.update":
    case "storyPlot.delete":
    case "storyPlot.reorder":
    case "connection.create":
    case "connection.update":
    case "connection.delete":
    case "placement.create":
    case "placement.update":
    case "placement.delete":
    case "placement.move":
    case "placement.reorder":
      applyPlotOperation(state, operation);
      return;
    case "foreshadowing.create":
    case "foreshadowing.update":
    case "foreshadowing.delete":
    case "foreshadowing.reorder":
    case "foreshadowingBeat.create":
    case "foreshadowingBeat.update":
    case "foreshadowingBeat.delete":
    case "foreshadowingBeat.move":
    case "foreshadowingBeat.reorder":
      applyForeshadowingOperation(state, operation);
      return;
  }
}
