<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.longLedgerFinalizationCard");
const proposalText = createScopedTranslator("components.longProposalReview");

const props = defineProps<{ item: LongWorkspaceProposalItem }>();

const emit = defineEmits<{
  approve: [];
  reject: [];
}>();

const event = computed(() =>
  props.item.event.type === "long.ledger_commit_proposal"
    ? props.item.event
    : null
);

const batchInfo = computed(() => {
  const input = event.value?.payload.input;
  if (!input) return "";
  const chapterCardIds =
    input.mode === "text_files_batch"
      ? input.chapterCardIds
      : [input.chapterCardId];
  const checkpointChapterCardId =
    input.mode === "text_files_batch"
      ? input.checkpointChapterCardId
      : input.chapterCardId;
  return t("batchOfValueChaptersFinalChapterCheckpointValue", {
    arg0: chapterCardIds.length,
    arg1: checkpointChapterCardId
  });
});

const statusLabel = computed(() => {
  switch (props.item.status) {
    case "waiting":
      return props.item.blockedByError
        ? proposalText("precedingChangeFailed")
        : t("waitingForPrerequisiteFiles");
    case "submitting":
      return t("archiving");
    case "accepted":
      return t("archived");
    case "error":
      return t("archiveFailed");
    case "previewing":
      return t("validating");
    case "ready":
      return t("awaitingArchive");
    default:
      return t("awaitingArchive");
  }
});

const statusMessage = computed(() => {
  if (props.item.status === "error") {
    return (
      props.item.error ??
      t("continuityLedgerArchivalFailedTheCurrentFilesRemainSaved")
    );
  }
  if (props.item.status === "waiting") {
    return props.item.blockedByError
      ? proposalText("waitingForPrecedingFileOperationsToFinishBeforeResuming")
      : t("theFullChapterBatchWillBeArchivedAfterAll");
  }
  if (props.item.status === "submitting") {
    return t("validatingBatchManuscriptsHistoricalLedgersAndFinalChapterFiles");
  }
  if (props.item.status === "accepted") {
    return t("theChapterBatchSharesOneContinuityRecordSavedIn");
  }
  return t("waitingToArchiveTheContinuityLedger");
});
</script>

<template>
  <section class="ledger-finalization-card" :class="`is-${item.status}`">
    <header>
      <span class="ledger-finalization-icon" aria-hidden="true">
        <AppIcon name="wand" :size="16" />
      </span>
      <div>
        <strong>{{ t("continuityLedgerArchive") }}</strong>
        <small>{{ batchInfo }}</small>
      </div>
      <span class="ledger-finalization-status">{{ statusLabel }}</span>
    </header>

    <p class="ledger-finalization-summary">
      {{ event?.payload.summary }}
    </p>
    <p class="ledger-finalization-message">{{ statusMessage }}</p>

    <footer v-if="item.status === 'error'">
      <button type="button" class="is-secondary" @click="emit('reject')">
        {{
          item.errorRetryable === false ? t("closeAndKeepFiles") : t("close")
        }}
      </button>
      <button
        v-if="item.errorRetryable !== false"
        type="button"
        class="is-primary"
        @click="emit('approve')"
      >
        {{ t("retryArchive") }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.ledger-finalization-card {
  display: grid;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.ledger-finalization-card.is-error {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--theme-line));
}

header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

header > div {
  display: grid;
  gap: 2px;
}

header small,
.ledger-finalization-summary,
.ledger-finalization-message {
  color: var(--text-secondary);
}

.ledger-finalization-icon {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
}

.ledger-finalization-status {
  font-size: 12px;
  color: var(--text-secondary);
}

.is-error .ledger-finalization-status,
.is-error .ledger-finalization-message {
  color: var(--text-primary);
}

p {
  margin: 0;
  line-height: 1.55;
}

.ledger-finalization-message {
  padding: 9px 10px;
  border-radius: 8px;
  background: var(--surface-muted);
  font-size: 12px;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button {
  min-height: 32px;
  padding: 0 13px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  cursor: pointer;
}

button.is-secondary {
  background: var(--surface-raised);
  color: var(--text-primary);
}

button.is-primary {
  border-color: var(--text-primary);
  background: var(--text-primary);
  color: var(--surface-main);
}
</style>
