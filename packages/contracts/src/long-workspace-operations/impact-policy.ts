import type {
  LongWorkspaceEntityChange,
  LongWorkspaceImpactConfirmation
} from "./impact-schema";
import type { LongWorkspaceOperation } from "./operation-schema";

export type LongWorkspaceDestructiveImpact = Pick<
  LongWorkspaceImpactConfirmation,
  "entityChanges" | "relationshipChanges" | "fileIntents" | "ledgerRecordEdits"
>;

/**
 * Destructive approval is based on the exact simulated outcome, not command
 * naming. Format conversions and future operations therefore cannot bypass
 * confirmation merely because their type does not end in `.delete`.
 */
export function longWorkspaceImpactIsDestructive(
  value: LongWorkspaceDestructiveImpact
): boolean {
  return (
    value.entityChanges.some(({ action }) => action === "delete") ||
    value.relationshipChanges.some(({ action }) => action === "delete") ||
    value.fileIntents.some(({ action }) => action === "delete") ||
    value.ledgerRecordEdits.length > 0
  );
}

/**
 * Explicit delete commands remain confirmation-gated even if a future handler
 * accidentally reports an empty impact. Outcome inspection additionally
 * catches destructive effects produced by updates and other command names.
 */
export function longWorkspaceOperationsRequireImpactConfirmation(
  operations: readonly Pick<LongWorkspaceOperation, "type">[],
  impact: LongWorkspaceDestructiveImpact
): boolean {
  return (
    operations.some(({ type }) => type.endsWith(".delete")) ||
    (longWorkspaceImpactIsDestructive(impact) &&
      !isOnlyChapterPrimaryArcChange(operations, impact))
  );
}

/** A same-volume rebind replaces planning links while retaining the chapter. */
function isOnlyChapterPrimaryArcChange(
  operations: readonly Pick<LongWorkspaceOperation, "type">[],
  impact: LongWorkspaceDestructiveImpact
): boolean {
  if (
    !operations.some(({ type }) => type === "chapter.move") ||
    operations.some(
      ({ type }) => type !== "chapter.move" && type !== "chapter.update"
    ) ||
    impact.fileIntents.length > 0 ||
    impact.ledgerRecordEdits.length > 0
  ) {
    return false;
  }
  const chapters = new Map<string, LongWorkspaceEntityChange>();
  const beats = new Map<string, LongWorkspaceEntityChange>();
  for (const change of impact.entityChanges) {
    if (change.action !== "update") return false;
    const fields = changedFields(change);
    if (change.kind === "chapter-card") {
      if (
        fields.some((field) => field !== "primaryArcId" && field !== "title")
      ) {
        return false;
      }
      chapters.set(change.id, change);
    } else if (change.kind === "foreshadowing-beat") {
      if (fields.some((field) => field !== "arcId")) return false;
      beats.set(change.id, change);
    } else {
      return false;
    }
  }
  if (
    ![...chapters.values()].some(
      ({ before, after }) => before?.primaryArcId !== after?.primaryArcId
    )
  ) {
    return false;
  }
  return impact.relationshipChanges.every((change) => {
    if (change.action === "update") return false;
    const edge = change.before ?? change.after;
    const sourceId = edge?.sourceId;
    if (typeof sourceId !== "string") return false;
    const entity =
      change.kind === "chapter-primary-arc"
        ? chapters.get(sourceId)
        : change.kind === "foreshadowing-beat-arc"
          ? beats.get(sourceId)
          : undefined;
    const snapshot =
      change.action === "delete" ? entity?.before : entity?.after;
    const field =
      change.kind === "chapter-primary-arc" ? "primaryArcId" : "arcId";
    return (
      snapshot !== undefined &&
      snapshot !== null &&
      snapshot[field] === edge?.targetId
    );
  });
}

function changedFields(change: LongWorkspaceEntityChange): string[] {
  const fields = new Set([
    ...Object.keys(change.before ?? {}),
    ...Object.keys(change.after ?? {})
  ]);
  return [...fields].filter(
    (field) =>
      JSON.stringify(change.before?.[field]) !==
      JSON.stringify(change.after?.[field])
  );
}
