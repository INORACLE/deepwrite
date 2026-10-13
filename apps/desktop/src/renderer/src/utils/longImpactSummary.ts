import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { registerFeatureMessages } from "../i18n";
import zhCN from "../i18n/messages/workspace/longImpactSummary/zh-CN";
import enUS from "../i18n/messages/workspace/longImpactSummary/en-US";

const t = registerFeatureMessages("workspace.impact", {
  "zh-CN": zhCN,
  "en-US": enUS
});

/** Presentation only: exact ids and snapshots remain in the approval payload. */
export function longImpactSummary(
  confirmation: LongWorkspaceImpactConfirmation,
  workspace?: {
    plot: {
      arcs: readonly Pick<
        LongWorkspaceIndexSnapshot["plot"]["arcs"][number],
        "id" | "title"
      >[];
    };
  } | null
): string {
  const chapters = confirmation.entityChanges.filter(
    (change) =>
      change.kind === "chapter-card" &&
      change.action === "update" &&
      change.before.volumeId === change.after.volumeId &&
      change.before.narrativeOrder === change.after.narrativeOrder &&
      change.before.primaryArcId !== change.after.primaryArcId
  );
  const bindingOnly =
    chapters.length > 0 &&
    confirmation.entityChanges.every(
      ({ kind }) => kind === "chapter-card" || kind === "foreshadowing-beat"
    ) &&
    confirmation.relationshipChanges.every(
      ({ kind }) =>
        kind === "chapter-primary-arc" || kind === "foreshadowing-beat-arc"
    ) &&
    confirmation.fileIntents.length === 0 &&
    confirmation.ledgerRecordEdits.length === 0;
  if (bindingOnly) {
    const descriptions = chapters.map(({ before, after }) => {
      const chapter =
        typeof after?.title === "string" ? after.title : t("currentChapter");
      const oldArc = workspace?.plot.arcs.find(
        ({ id }) => id === before?.primaryArcId
      )?.title;
      const nextArc = workspace?.plot.arcs.find(
        ({ id }) => id === after?.primaryArcId
      )?.title;
      if (after?.primaryArcId === null) {
        return oldArc
          ? t("unbindFrom", { chapter, arc: oldArc })
          : t("unbind", { chapter });
      }
      if (nextArc) {
        return oldArc
          ? t("rebind", { chapter, before: oldArc, after: nextArc })
          : t("bind", { chapter, arc: nextArc });
      }
      return t("changeBinding", { chapter });
    });
    const beats = confirmation.entityChanges.filter(
      ({ kind }) => kind === "foreshadowing-beat"
    ).length;
    return t("sentence", {
      description:
        descriptions.join(t("separator")) +
        (beats ? t("adjustBeats", { count: beats }) : "")
    });
  }
  const counts = [
    ["create", "add"],
    ["update", "update"],
    ["delete", "delete"]
  ] as const;
  const parts = counts.flatMap(([action, key]) => {
    const count = confirmation.entityChanges.filter(
      (change) => change.action === action
    ).length;
    return count ? [t(key, { count })] : [];
  });
  const links = confirmation.relationshipChanges.length;
  const createdFiles = confirmation.fileIntents.filter(
    ({ action }) => action === "create"
  ).length;
  const deletedFiles = confirmation.fileIntents.filter(
    ({ action }) => action === "delete"
  ).length;
  const records = confirmation.ledgerRecordEdits.length;
  if (links) parts.push(t("links", { count: links }));
  if (createdFiles) parts.push(t("createFiles", { count: createdFiles }));
  if (deletedFiles) parts.push(t("deleteFiles", { count: deletedFiles }));
  if (records) parts.push(t("records", { count: records }));
  return parts.length
    ? t("sentence", { description: parts.join(t("separator")) })
    : t("contentOnly");
}
