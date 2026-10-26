import { createScopedTranslator } from "../i18n";
import { isLongChapterContinuityReadOnly } from "@deepwrite/contracts/renderer";

import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongChapterCardId
} from "@deepwrite/contracts";
import type {
  LongWorkspaceSelection,
  LongWorkspaceSelectionFile
} from "./longWorkspace";
import {
  indexedVolume,
  indexedChapterCard,
  type LongChapterLookup
} from "./longIndexedChapter";

const t = createScopedTranslator("workspace.selection");

/**
 * Keeps chapter authoring and continuity review as two distinct entry points.
 * Evidence stays read-only; the latest recorded checkpoint remains editable;
 * the internal commit JSON is never part of the visible selection.
 */
export function createLongContinuitySelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId,
  lookup?: LongChapterLookup
): LongWorkspaceSelection | undefined {
  const chapter = indexedChapterCard(
    summary,
    workspaceIndex,
    chapterCardId,
    lookup
  );
  const volume = chapter
    ? indexedVolume(summary, workspaceIndex, chapter.volumeId, lookup)
    : undefined;
  const entry = lookup
    ? lookup.entries.get(chapterCardId)
    : workspaceIndex.chapters.find(
        (candidate) => candidate.chapterCardId === chapterCardId
      );
  if (!chapter || !volume || !entry) {
    return undefined;
  }
  const committed = entry.commitId !== null;
  const readOnly = isLongChapterContinuityReadOnly(workspaceIndex, entry);
  const commit = committed
    ? lookup
      ? lookup.commits.get(entry.commitId!)
      : workspaceIndex.ledger.commits.find(({ id }) => id === entry.commitId)
    : undefined;
  const importCheckpoint = commit?.mode === "import_checkpoint";
  if (!committed && entry.bodyStatus !== "written") {
    return undefined;
  }
  const characterNameById =
    lookup?.characterNames ??
    new Map(
      summary.navigation.characters.map(({ id, name }) => [id, name] as const)
    );
  const characterContinuityFiles = [...(entry.characterContinuity ?? [])]
    .sort((left, right) =>
      (
        characterNameById.get(left.characterId) ?? left.characterId
      ).localeCompare(
        characterNameById.get(right.characterId) ?? right.characterId,
        "zh-CN"
      )
    )
    .flatMap<LongWorkspaceSelectionFile>((character) => {
      const name =
        characterNameById.get(character.characterId) ?? character.characterId;
      return [
        {
          role: "current-state",
          get label() {
            return t("namedCurrentState", { name: name });
          },
          file: character.currentState,
          readOnly
        },
        {
          role: "history",
          get label() {
            return t("namedHistory", { name: name });
          },
          file: character.history,
          readOnly
        }
      ];
    });
  return {
    key: `continuity:${chapter.id}`,
    root: "continuity_ledger",
    continuityView: committed ? "history" : "inbox",
    chapterCardId: chapter.id,
    title: chapter.title || chapter.id,
    get breadcrumbs() {
      return [
        summary.title,
        t("continuityLedger"),
        volume.title,
        chapter.title || chapter.id
      ];
    },
    files: [
      {
        role: "body",
        get label() {
          return t("manuscriptEvidence");
        },
        file: entry.body,
        readOnly: true
      },
      ...(importCheckpoint ? [] : characterContinuityFiles),
      ...(entry.worldReveals && !importCheckpoint
        ? [
            {
              role: "world-reveals" as const,
              get label() {
                return t("worldRevelations");
              },
              file: entry.worldReveals,
              readOnly
            }
          ]
        : []),
      ...(!importCheckpoint
        ? [
            {
              role: "foreshadowing-changes" as const,
              get label() {
                return t("foreshadowingChanges");
              },
              file: entry.foreshadowingChanges,
              readOnly
            }
          ]
        : []),
      ...(importCheckpoint
        ? []
        : [
            {
              role: "character-state" as const,
              get label() {
                return t("chapterEndState");
              },
              file: entry.characterState,
              readOnly
            },
            {
              role: "handoff" as const,
              get label() {
                return t("handoff");
              },
              file: entry.handoff,
              readOnly
            }
          ])
    ],
    preferredRole: "body",
    get description() {
      return importCheckpoint
        ? t("checkpointHelp")
        : committed
          ? t("chapterContinuityHelp")
          : t("pendingContinuityHelp");
    }
  };
}
