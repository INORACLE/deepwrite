import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { createLongChapterPrimaryArcOperation } from "@deepwrite/contracts/renderer";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";

const t = createScopedTranslator("components.longChapterPlotBinding");

export function useLongChapterPlotBinding(options: {
  bookId: () => string;
  chapterCardId: () => string;
  snapshot: () => LongWorkspaceIndexSnapshot;
  locked: () => boolean;
  preview(
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ): void;
  mutate(
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ): void;
  warn(message: string): void;
}) {
  const chapter = computed(() =>
    options
      .snapshot()
      .plot.chapterCards.find(({ id }) => id === options.chapterCardId())
  );
  const open = ref(false);
  const primaryArcId = ref("");
  const previewPending = ref(false);
  const pending = ref(false);
  const prepared = shallowRef<{
    batch: LongWorkspaceOperationBatch;
    confirmation: LongWorkspaceImpactConfirmation;
  } | null>(null);
  let request = 0;

  function reset(): void {
    request += 1;
    open.value = false;
    pending.value = false;
    previewPending.value = false;
    prepared.value = null;
  }

  function close(): void {
    if (!pending.value) reset();
  }

  function edit(): void {
    if (options.locked() || !chapter.value) return;
    primaryArcId.value = chapter.value.primaryArcId ?? "";
    open.value = true;
  }

  function prepare(): void {
    const token = ++request;
    prepared.value = null;
    previewPending.value = false;
    if (!open.value || pending.value) return;
    try {
      const operation = createLongChapterPrimaryArcOperation(
        options.snapshot(),
        options.chapterCardId(),
        primaryArcId.value || null
      );
      if (!operation) return;
      const batch: LongWorkspaceOperationBatch = {
        updatedAt: new Date().toISOString(),
        operations: [operation],
        documentWrites: []
      };
      previewPending.value = true;
      options.preview(batch, (confirmation) => {
        if (token !== request || !open.value) return;
        previewPending.value = false;
        if (confirmation) prepared.value = { batch, confirmation };
      });
    } catch (error: unknown) {
      options.warn(formatError(error, t("couldNotPrepare")));
    }
  }

  function submit(): void {
    const target = prepared.value;
    if (!open.value || !target || pending.value || options.locked()) return;
    const bookId = options.bookId();
    const chapterCardId = options.chapterCardId();
    const token = ++request;
    const isCurrent = () =>
      open.value &&
      token === request &&
      bookId === options.bookId() &&
      chapterCardId === options.chapterCardId();
    pending.value = true;
    options.mutate(
      { ...target.batch, expectedImpact: target.confirmation },
      {
        succeed() {
          if (isCurrent()) reset();
        },
        fail(_message, changedImpact) {
          if (!isCurrent()) return;
          pending.value = false;
          if (changedImpact) {
            prepared.value = {
              batch: target.batch,
              confirmation: changedImpact
            };
          } else {
            prepare();
          }
        },
        appliedButRefreshFailed() {
          if (isCurrent()) reset();
        }
      }
    );
  }

  watch(() => [options.bookId(), options.chapterCardId()] as const, reset, {
    flush: "sync"
  });
  watch(
    () => [open.value, primaryArcId.value, options.snapshot()] as const,
    () => {
      if (!pending.value) prepare();
    }
  );
  onScopeDispose(reset);

  return {
    chapter,
    open,
    primaryArcId,
    previewPending,
    pending,
    prepared,
    edit,
    close,
    submit
  };
}
