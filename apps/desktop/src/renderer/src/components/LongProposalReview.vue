<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type {
  LongContinuityFileChange,
  LongContinuityFileRole,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { buildAgentTextDiff } from "../utils/agentTextDiff";
import AppIcon from "./AppIcon.vue";
import LongLedgerFinalizationCard from "./LongLedgerFinalizationCard.vue";
import LongProposalImpactDetails from "./LongProposalImpactDetails.vue";

const t = createScopedTranslator("components.longProposalReview");

const props = withDefaults(
  defineProps<{
    items: LongWorkspaceProposalItem[];
    workspaceIndex?: LongWorkspaceIndexSnapshot | null;
    embedded?: boolean;
    conversationCard?: boolean;
  }>(),
  {
    embedded: false,
    conversationCard: false
  }
);

const emit = defineEmits<{
  approve: [eventId: string];
  reject: [eventId: string];
  retryPreview: [eventId: string];
  locate: [eventId: string];
}>();

const pendingCount = computed(
  () => props.items.filter(({ status }) => status !== "accepted").length
);
const completedCount = computed(
  () => props.items.filter(({ status }) => status === "accepted").length
);

type LongContentFileChange = Extract<
  LongWorkspaceProposalItem["event"],
  {
    type:
      | "long.worldbuilding_file_proposal"
      | "long.character_file_proposal"
      | "long.continuity_file_proposal";
  }
>["payload"]["files"][number];

function isContentFileProposalItem(item: LongWorkspaceProposalItem): boolean {
  return (
    item.event.type === "long.worldbuilding_file_proposal" ||
    item.event.type === "long.character_file_proposal" ||
    item.event.type === "long.continuity_file_proposal"
  );
}

const hasEditProposalSurfaceItems = computed(() =>
  props.items.some(
    (item) =>
      item.event.type === "long.mutation_proposal" ||
      isContentFileProposalItem(item)
  )
);

const contentFileCards = computed(() => {
  const cards = new Map<
    string,
    Array<{
      file: LongContentFileChange;
      diff: ReturnType<typeof buildAgentTextDiff>;
    }>
  >();
  for (const item of props.items) {
    if (
      item.event.type !== "long.worldbuilding_file_proposal" &&
      item.event.type !== "long.character_file_proposal" &&
      item.event.type !== "long.continuity_file_proposal"
    )
      continue;
    cards.set(
      item.event.id,
      item.event.payload.files.map((file) => ({
        file,
        diff: buildAgentTextDiff(file.beforeText, file.afterText)
      }))
    );
  }
  return cards;
});

const continuityRoleLabels: Record<LongContinuityFileRole, string> = {
  get foreshadowing_changes() {
    return t("foreshadowingChanges");
  },
  get world_reveals() {
    return t("worldbuildingReveals");
  },
  get character_current_state() {
    return t("currentCharacterState");
  },
  get character_history() {
    return t("characterHistory");
  },
  get chapter_end_state() {
    return t("endOfChapterState");
  },
  get handoff() {
    return t("handoffPackage");
  }
};

function trustedContinuityIdentity(fileId: string): {
  chapterCardId: string;
  role: LongContinuityFileRole;
  characterId: string | null;
} | null {
  const index = props.workspaceIndex;
  if (!index) return null;
  for (const chapter of index.chapters) {
    if (chapter.characterState.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "chapter_end_state",
        characterId: null
      };
    }
    if (chapter.handoff.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "handoff",
        characterId: null
      };
    }
    if (chapter.foreshadowingChanges.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "foreshadowing_changes",
        characterId: null
      };
    }
    if (chapter.worldReveals?.id === fileId) {
      return {
        chapterCardId: chapter.chapterCardId,
        role: "world_reveals",
        characterId: null
      };
    }
    for (const continuity of chapter.characterContinuity) {
      if (continuity.currentState.id === fileId) {
        return {
          chapterCardId: chapter.chapterCardId,
          role: "character_current_state",
          characterId: continuity.characterId
        };
      }
      if (continuity.history.id === fileId) {
        return {
          chapterCardId: chapter.chapterCardId,
          role: "character_history",
          characterId: continuity.characterId
        };
      }
    }
  }
  return null;
}

function continuityFileTitle(
  item: LongWorkspaceProposalItem,
  file: LongContinuityFileChange
): string {
  const index = props.workspaceIndex;
  const identity = trustedContinuityIdentity(file.fileId);
  const trusted =
    identity ??
    (item.preview
      ? {
          chapterCardId: file.chapterCardId,
          role: file.role,
          characterId: file.characterId
        }
      : null);
  if (!index || !trusted) return t("continuityFilesPendingValidation");
  const chapter = index.plot.chapterCards.find(
    ({ id }) => id === trusted.chapterCardId
  );
  const character =
    trusted.characterId === null
      ? null
      : index.characters.find(({ id }) => id === trusted.characterId);
  if (!chapter || (trusted.characterId !== null && !character)) {
    return t("continuityFilesPendingValidation");
  }
  return `${chapter.title} / ${
    character ? `${character.name} / ` : ""
  }${continuityRoleLabels[trusted.role]}`;
}

function contentFileTitle(
  item: LongWorkspaceProposalItem,
  file: LongContentFileChange
): string {
  return item.event.type === "long.continuity_file_proposal"
    ? continuityFileTitle(item, file as LongContinuityFileChange)
    : file.title;
}

function canDisplayContentFileDiff(item: LongWorkspaceProposalItem): boolean {
  return (
    item.event.type !== "long.continuity_file_proposal" ||
    (Boolean(item.preview) &&
      (item.status === "ready" ||
        item.status === "submitting" ||
        item.status === "accepted"))
  );
}

function proposalTitle(item: LongWorkspaceProposalItem): string {
  switch (item.event.type) {
    case "long.mutation_proposal":
      return t("structureChanges");
    case "long.worldbuilding_file_proposal":
      return item.event.payload.files.length === 1
        ? item.event.payload.files[0]!.title
        : t("valueWorldbuildingFiles", {
            arg0: item.event.payload.files.length
          });
    case "long.character_file_proposal":
      return item.event.payload.files.length === 1
        ? item.event.payload.files[0]!.title
        : t("valueFilesForValue", {
            arg0: item.event.payload.files[0]?.characterName ?? t("characters"),
            arg1: item.event.payload.files.length
          });
    case "long.continuity_file_proposal":
      return item.event.payload.files.length === 1
        ? contentFileTitle(item, item.event.payload.files[0]!)
        : t("valueContinuityFiles", {
            arg0: item.event.payload.files.length
          });
    case "long.ledger_commit_proposal":
      return t("continuityLedgerArchive");
  }
}

function proposalAction(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("processing");
  if (item.approvalMode === "auto-approve" && item.status === "error") {
    return t("retryAutosave");
  }
  if (item.status === "error" && item.event.type !== "long.mutation_proposal") {
    return t("retry");
  }
  switch (item.event.type) {
    case "long.mutation_proposal":
      return t("apply");
    case "long.worldbuilding_file_proposal":
    case "long.character_file_proposal":
    case "long.continuity_file_proposal":
      return t("writeAndSave");
    case "long.ledger_commit_proposal":
      return item.status === "error" ? t("retryArchive") : t("archiveNow");
  }
}

function proposalStatusText(item: LongWorkspaceProposalItem): string {
  if (item.status === "waiting" && item.blockedByError) {
    return t("precedingChangeFailed");
  }
  if (item.event.type === "long.ledger_commit_proposal") {
    if (item.status === "accepted") return t("archived");
    if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
    if (item.status === "submitting") return t("archiving");
    if (item.status === "error") return t("archiveFailed");
    return t("awaitingArchive");
  }
  if (item.status === "accepted") return t("accepted");
  if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
  if (item.status === "previewing") {
    return item.approvalMode === "auto-approve"
      ? t("automaticPreview")
      : t("previewing");
  }
  if (item.status === "submitting") {
    return item.approvalMode === "auto-approve"
      ? t("autosaving")
      : t("processingLabel");
  }
  if (item.status === "error") {
    if (item.errorPhase === "preview") return t("validationFailed");
    return item.approvalMode === "auto-approve"
      ? t("autosaveFailed")
      : item.errorRetryable === false
        ? t("cannotApply")
        : t("failedToApply");
  }
  return item.approvalMode === "auto-approve"
    ? t("awaitingAutosave")
    : t("awaitingConfirmation");
}

function contentProposalVisualStatus(
  item: LongWorkspaceProposalItem
): "pending" | "accepting" | "accepted" | "error" {
  if (item.status === "accepted") return "accepted";
  if (item.status === "error") return "error";
  if (item.status === "previewing" || item.status === "submitting") {
    return "accepting";
  }
  return "pending";
}

function contentProposalStatusLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "waiting" && item.blockedByError) {
    return t("precedingChangeFailed");
  }
  if (item.status === "accepted") return t("accepted");
  if (item.status === "error") {
    return item.errorPhase === "preview"
      ? t("validationFailed")
      : t("failedToApply");
  }
  if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
  if (item.status === "previewing") return t("validating");
  if (item.status === "submitting") return t("applying");
  return item.approvalMode === "auto-approve"
    ? t("awaitingAutosaveLabel")
    : t("awaitingReview");
}

function contentProposalDiffStats(item: LongWorkspaceProposalItem): {
  additions: number;
  deletions: number;
  hunks: number;
} {
  return (contentFileCards.value.get(item.event.id) ?? []).reduce(
    (total, card) => ({
      additions: total.additions + card.diff.additions,
      deletions: total.deletions + card.diff.deletions,
      hunks: total.hunks + card.diff.hunks.length
    }),
    { additions: 0, deletions: 0, hunks: 0 }
  );
}

function contentProposalStatusMessage(item: LongWorkspaceProposalItem): string {
  if (item.status === "accepted") {
    return item.approvalMode === "auto-approve"
      ? t("automaticallyApprovedAndSavedToLocalMarkdown")
      : t("changesAppliedAndSavedLocally");
  }
  if (item.status === "error") {
    if (item.errorPhase === "preview") {
      return item.error ?? t("couldNotReadTheChangeImpactContentHasNot");
    }
    return item.error ?? t("changesCouldNotBeSavedSaveAgainOrReject");
  }
  if (item.status === "waiting") {
    return t("waitingForPrecedingFileOperationsToFinishBeforeResuming");
  }
  if (item.status === "previewing") {
    return t("readingFilesAndChangeImpact");
  }
  if (item.status === "submitting") {
    return t("applyingAndSavingChanges");
  }
  return item.approvalMode === "auto-approve"
    ? t("addedToTheAutosaveQueue")
    : t("acceptToApplyToTheCorrespondingMarkdownFilesAnd");
}

function showContentProposalActions(item: LongWorkspaceProposalItem): boolean {
  return (
    item.status !== "accepted" &&
    (item.approvalMode !== "auto-approve" || item.status === "error")
  );
}

function contentProposalAcceptDisabled(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.status === "previewing" ||
    item.status === "submitting" ||
    item.status === "waiting" ||
    (item.status === "error" && item.errorRetryable === false) ||
    (item.status === "ready" && !item.preview)
  );
}

function contentProposalAcceptLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("saving");
  if (item.status === "error" && item.errorRetryable === false) {
    return t("cannotSave");
  }
  return item.status === "error"
    ? item.errorPhase === "preview"
      ? t("reloadAndSave")
      : t("saveAgain")
    : t("acceptAndSave");
}

function isStructureProposalItem(item: LongWorkspaceProposalItem): boolean {
  return item.event.type === "long.mutation_proposal";
}

function usesEditProposalSurface(item: LongWorkspaceProposalItem): boolean {
  return isStructureProposalItem(item) || isContentFileProposalItem(item);
}

function proposalVisualStatus(
  item: LongWorkspaceProposalItem
): "pending" | "accepting" | "accepted" | "rejected" | "conflict" | "error" {
  return contentProposalVisualStatus(item);
}

function structureProposalStatusMessage(
  item: LongWorkspaceProposalItem
): string {
  if (item.status === "waiting") {
    return t("waitingForPrecedingFileOperationsToFinishBeforeResuming");
  }
  if (item.status === "accepted")
    return t("structureChangesAppliedAndSavedLocally");
  if (item.status === "error") {
    if (item.errorPhase === "preview") {
      return item.error ?? t("couldNotReadStructuralImpactChangesHaveNotBeen");
    }
    return item.error ?? t("structureChangesCouldNotBeAppliedPreviewAgainTo");
  }
  if (item.status === "previewing") {
    return t("readingCurrentStructureAndImpact");
  }
  if (item.status === "submitting") {
    return t("applyingStructureChanges");
  }
  return item.approvalMode === "auto-approve"
    ? t("addedToTheAutosaveQueue")
    : t("acceptToApplyToThisBookSStructureAnd");
}

function structureProposalAcceptDisabled(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.status === "previewing" ||
    item.status === "submitting" ||
    item.status === "waiting" ||
    (item.status === "error" && item.errorRetryable === false) ||
    (item.status === "ready" && !item.preview)
  );
}

function structureProposalAcceptLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("applyingLabel");
  if (item.status === "error" && item.errorRetryable === false) {
    return t("cannotApply");
  }
  return item.status === "error"
    ? item.errorPhase === "preview"
      ? t("revalidateAndApply")
      : t("retryApplying")
    : t("acceptAndApply");
}

function diffLineMark(type: "context" | "addition" | "deletion"): string {
  if (type === "addition") return "+";
  if (type === "deletion") return "−";
  return " ";
}
</script>

<template>
  <section
    v-if="items.length"
    class="long-proposal-review"
    :class="{
      'is-embedded': embedded,
      'is-conversation-card': conversationCard,
      'has-edit-proposal-surface-items': hasEditProposalSurfaceItems
    }"
    :aria-label="t('novelProposalsAwaitingApproval')"
  >
    <header v-if="!embedded">
      <div>
        <span>{{ t("agentWrites") }}</span>
        <strong v-if="pendingCount">{{
          t("processingMessage", {
            arg0: pendingCount ?? ""
          })
        }}</strong>
        <strong v-else>{{
          t("savedMessage", {
            arg0: completedCount ?? ""
          })
        }}</strong>
      </div>
      <small>{{ t("allChangesAreScopedToTheCurrentBook") }}</small>
    </header>

    <div class="long-proposal-list">
      <article
        v-for="item in items"
        :key="item.event.id"
        :class="
          item.event.type === 'long.ledger_commit_proposal'
            ? 'long-ledger-finalization-item'
            : usesEditProposalSurface(item)
              ? ['edit-proposal-card', `is-${proposalVisualStatus(item)}`]
              : 'long-proposal-card'
        "
        :data-proposal-type="item.event.type"
        :aria-busy="item.status === 'submitting'"
      >
        <LongLedgerFinalizationCard
          v-if="item.event.type === 'long.ledger_commit_proposal'"
          :item="item"
          @approve="emit('approve', item.event.id)"
          @reject="emit('reject', item.event.id)"
        />
        <div
          v-if="
            item.event.type !== 'long.ledger_commit_proposal' &&
            !usesEditProposalSurface(item)
          "
          class="long-proposal-heading"
        >
          <span class="long-proposal-icon">
            <AppIcon
              :name="
                item.event.type === 'long.worldbuilding_file_proposal' ||
                item.event.type === 'long.character_file_proposal' ||
                item.event.type === 'long.continuity_file_proposal'
                  ? 'file'
                  : 'wand'
              "
              :size="15"
            />
          </span>
          <div>
            <strong>{{ proposalTitle(item) }}</strong>
            <small>{{ item.event.payload.agentId }}</small>
          </div>
          <div class="approval-status-actions">
            <span class="long-proposal-status" :class="`is-${item.status}`">
              {{ proposalStatusText(item) }}
            </span>
            <button
              v-if="item.status === 'accepted'"
              class="approval-target-button"
              type="button"
              :title="t('goToTargetFile')"
              :aria-label="t('goToTargetFile')"
              @click.stop="emit('locate', item.event.id)"
            >
              {{ t("goToTargetFile") }}
            </button>
          </div>
        </div>

        <p
          v-if="
            item.event.type !== 'long.ledger_commit_proposal' &&
            !usesEditProposalSurface(item)
          "
        >
          {{ item.event.payload.summary }}
        </p>

        <template v-if="usesEditProposalSurface(item)">
          <header class="edit-proposal-header">
            <span class="edit-proposal-icon" aria-hidden="true">
              <AppIcon
                :name="isStructureProposalItem(item) ? 'wand' : 'file'"
                :size="17"
              />
            </span>
            <div class="edit-proposal-heading">
              <div class="edit-proposal-title-row">
                <strong>{{ proposalTitle(item) }}</strong>
                <span
                  class="edit-proposal-status"
                  :class="`is-${proposalVisualStatus(item)}`"
                >
                  {{
                    isStructureProposalItem(item)
                      ? proposalStatusText(item)
                      : contentProposalStatusLabel(item)
                  }}
                </span>
                <button
                  v-if="item.status === 'accepted'"
                  class="approval-target-button"
                  type="button"
                  :title="t('goToTargetFile')"
                  :aria-label="t('goToTargetFile')"
                  @click.stop="emit('locate', item.event.id)"
                >
                  {{ t("goToTargetFile") }}
                </button>
              </div>
              <p>{{ item.event.payload.summary }}</p>
            </div>
            <div
              v-if="
                isContentFileProposalItem(item) &&
                canDisplayContentFileDiff(item)
              "
              class="edit-proposal-stats"
              :aria-label="
                t('valueLinesAddedValueLinesRemoved', {
                  arg0: contentProposalDiffStats(item).additions,
                  arg1: contentProposalDiffStats(item).deletions
                })
              "
            >
              <span class="is-addition">
                +{{ contentProposalDiffStats(item).additions }}
              </span>
              <span class="is-deletion">
                −{{ contentProposalDiffStats(item).deletions }}
              </span>
            </div>
          </header>

          <details
            v-if="
              isContentFileProposalItem(item) &&
              canDisplayContentFileDiff(item) &&
              contentProposalDiffStats(item).hunks
            "
            class="edit-proposal-diff"
          >
            <summary>
              <span>{{ t("viewChanges") }}</span>
              <small>
                {{
                  t("changeBlocksMessage", {
                    arg0: contentProposalDiffStats(item).hunks ?? ""
                  })
                }}
              </small>
              <AppIcon name="chevron" :size="13" />
            </summary>
            <div class="edit-diff-content">
              <section
                v-for="card in contentFileCards.get(item.event.id) ?? []"
                :key="card.file.fileId"
                class="long-edit-diff-file"
              >
                <div
                  v-if="(contentFileCards.get(item.event.id)?.length ?? 0) > 1"
                  class="long-edit-diff-file-label"
                >
                  {{ contentFileTitle(item, card.file) }}
                </div>
                <div
                  v-for="(hunk, hunkIndex) in card.diff.hunks"
                  :key="`${card.file.fileId}:hunk:${hunkIndex}`"
                  class="edit-diff-hunk"
                >
                  <div class="edit-diff-hunk-header">
                    @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{
                      hunk.newStart
                    }},{{ hunk.newLines }}
                    @@
                  </div>
                  <div
                    v-for="(line, lineIndex) in hunk.lines"
                    :key="`${card.file.fileId}:${hunkIndex}:${lineIndex}`"
                    class="edit-diff-line"
                    :class="`is-${line.type}`"
                  >
                    <span class="edit-diff-line-number">
                      {{ line.oldLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-number">
                      {{ line.newLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-mark" aria-hidden="true">
                      {{ diffLineMark(line.type) }}
                    </span>
                    <code>{{ line.text }}</code>
                  </div>
                </div>
                <p v-if="card.diff.truncated" class="edit-diff-truncated">
                  {{ t("thisDiffIsLargeSoOnlySomeChangesAre") }}
                </p>
              </section>
            </div>
          </details>
          <p
            v-else-if="
              isContentFileProposalItem(item) &&
              !canDisplayContentFileDiff(item)
            "
            class="edit-proposal-empty"
          >
            {{ t("fileIdentityAndSourceContentHaveNotPassedValidation") }}
          </p>
          <p
            v-else-if="isContentFileProposalItem(item)"
            class="edit-proposal-empty"
          >
            {{ t("aBlankMarkdownFileWasCreatedNoManuscriptLine") }}
          </p>

          <footer class="edit-proposal-footer">
            <span class="edit-proposal-message">
              {{
                isStructureProposalItem(item)
                  ? structureProposalStatusMessage(item)
                  : contentProposalStatusMessage(item)
              }}
            </span>
            <div
              v-if="
                isStructureProposalItem(item)
                  ? item.status !== 'accepted' &&
                    (item.approvalMode !== 'auto-approve' ||
                      item.status === 'error')
                  : showContentProposalActions(item)
              "
              class="edit-proposal-actions"
            >
              <button
                class="edit-review-button is-reject"
                type="button"
                :disabled="item.status === 'submitting'"
                @click="emit('reject', item.event.id)"
              >
                {{ t("reject") }}
              </button>
              <button
                class="edit-review-button is-accept"
                type="button"
                :disabled="
                  isStructureProposalItem(item)
                    ? structureProposalAcceptDisabled(item)
                    : contentProposalAcceptDisabled(item)
                "
                @click="emit('approve', item.event.id)"
              >
                {{
                  isStructureProposalItem(item)
                    ? structureProposalAcceptLabel(item)
                    : contentProposalAcceptLabel(item)
                }}
              </button>
            </div>
          </footer>
        </template>

        <LongProposalImpactDetails
          v-if="item.event.type === 'long.mutation_proposal' && item.preview"
          :item="item"
          :workspace-index="workspaceIndex"
        />

        <footer
          v-if="
            item.event.type !== 'long.ledger_commit_proposal' &&
            !usesEditProposalSurface(item) &&
            item.status !== 'accepted' &&
            (item.approvalMode !== 'auto-approve' || item.status === 'error')
          "
        >
          <button
            class="long-proposal-secondary"
            type="button"
            :disabled="item.status === 'submitting'"
            @click="emit('reject', item.event.id)"
          >
            {{ t("reject") }}
          </button>
          <button
            v-if="
              (item.event.type === 'long.mutation_proposal' ||
                item.event.type === 'long.worldbuilding_file_proposal' ||
                item.event.type === 'long.character_file_proposal' ||
                item.event.type === 'long.continuity_file_proposal') &&
              item.status === 'error'
            "
            class="long-proposal-secondary"
            type="button"
            @click="emit('retryPreview', item.event.id)"
          >
            {{ t("previewAgain") }}
          </button>
          <button
            class="long-proposal-primary"
            type="button"
            :disabled="
              item.status === 'previewing' ||
              item.status === 'submitting' ||
              ((item.event.type === 'long.mutation_proposal' ||
                item.event.type === 'long.worldbuilding_file_proposal' ||
                item.event.type === 'long.character_file_proposal' ||
                item.event.type === 'long.continuity_file_proposal') &&
                (item.status !== 'ready' || !item.preview))
            "
            @click="emit('approve', item.event.id)"
          >
            {{ proposalAction(item) }}
          </button>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.long-proposal-review {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: min(43%, 360px);
  min-height: 0;
  border-top: 1px solid var(--theme-line);
  background: var(--surface-muted);
  color: var(--text-primary);
}

.long-proposal-review.is-embedded {
  max-height: none;
  border-top: 0;
  background: transparent;
}

.long-proposal-review.is-embedded .long-proposal-list {
  padding: 10px 0 0;
  overflow: visible;
}

.long-proposal-review.is-embedded.has-edit-proposal-surface-items
  .long-proposal-list {
  gap: 12px;
  padding: 0;
  margin: 14px 0 20px;
}

.long-proposal-review.is-embedded.is-conversation-card .long-proposal-list {
  padding: 0;
  margin: 0;
}

.long-proposal-review > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-proposal-review > header > div {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.long-proposal-review > header span,
.long-proposal-review > header small {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-proposal-review > header strong {
  font-size: 0.75rem;
}

.long-proposal-list {
  display: grid;
  gap: 7px;
  min-height: 0;
  padding: 8px;
  overflow: auto;
}

.long-proposal-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
}

.long-proposal-heading {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.long-proposal-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
}

.long-proposal-heading > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.long-proposal-heading strong {
  font-size: 0.75rem;
}

.long-proposal-heading small {
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

.long-proposal-status {
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--surface-selected);
  color: var(--text-secondary);
  font-size: 0.607143rem;
}

.long-proposal-status.is-error {
  color: var(--danger);
}

.long-proposal-status.is-accepted {
  background: color-mix(in srgb, var(--success) 13%, transparent);
  color: var(--success);
}

.long-proposal-card > p {
  color: var(--text-secondary);
  font-size: 0.678571rem;
  line-height: 1.55;
}

.long-edit-diff-file + .long-edit-diff-file {
  border-top: 1px solid var(--theme-line-soft);
}

.long-edit-diff-file-label {
  padding: 6px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.long-proposal-card footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.long-proposal-card button {
  min-height: 27px;
  padding: 4px 9px;
  border-radius: 7px;
  font-size: 0.678571rem;
  cursor: pointer;
}

.long-proposal-card button:disabled {
  cursor: default;
  opacity: 0.55;
}

.long-proposal-secondary {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.long-proposal-secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-proposal-primary {
  background: var(--neutral-solid);
  color: var(--accent-contrast, #fff);
}

:global(html[data-theme="dark"] .long-proposal-primary) {
  background: var(--accent);
}
</style>
