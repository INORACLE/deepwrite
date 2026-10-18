import { createScopedTranslator } from "../../i18n";
import type {
  LongStructureMutationLease,
  LongStructureMutationTargetSnapshot,
  LongStructureTransactionsCoordinatorOptions
} from "./types";

const t = createScopedTranslator("workspace");

export function createLongStructureLease(
  options: LongStructureTransactionsCoordinatorOptions
) {
  const { notifications: uiMessage, session, state } = options;
  const {
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    mutationPending: longBookActionPending,
    structureDialogOpen: longStructureDialogOpen,
    characterCreateTarget: longCharacterCreate,
    worldbuildingItemCreateTarget: longWorldbuildingItemCreate,
    plotPointCreateTarget: longPlotPointCreate,
    chapterCardCreateTarget: longChapterCardCreate,
    draftSectionDeleteTarget: longDraftSectionDelete,
    treeItemDeleteTarget: longTreeItemDelete,
    volumeCreateTarget: longVolumeCreate
  } = state;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  let mutationRequestEpoch = 0;
  let dialogRequestEpoch = 0;
  let activeMutation: LongStructureMutationLease | null = null;
  const inFlightOperations = new Set<Promise<unknown>>();
  const isDisposed = () => disposed;
  function captureLongStructureMutationTarget(
    expectedBookId: string | null | undefined
  ): LongStructureMutationTargetSnapshot | null {
    const summary = activeLongBookSummary.value;
    const index = activeLongWorkspaceIndex.value;
    if (
      !expectedBookId ||
      activeLongBookId.value !== expectedBookId ||
      summary?.id !== expectedBookId ||
      !index
    ) {
      return null;
    }
    return { bookId: expectedBookId, index };
  }
  function mutationIsCurrent(lease: LongStructureMutationLease): boolean {
    return (
      !disposed &&
      activeMutation === lease &&
      lease.requestId === mutationRequestEpoch
    );
  }
  function assertCurrentLongStructureMutationTarget(
    target: LongStructureMutationTargetSnapshot,
    lease: LongStructureMutationLease,
    message = t("lease.theActiveLongFormProjectOrStructureChangedThese")
  ): void {
    const current = captureLongStructureMutationTarget(target.bookId);
    if (
      !mutationIsCurrent(lease) ||
      !current ||
      current.index !== target.index
    ) {
      throw new Error(message);
    }
  }
  function acquireMutation(
    expectedBookId: string | null | undefined,
    blockUi: boolean
  ): { lease: LongStructureMutationLease } | { message: string } | null {
    if (disposed) return null;
    const target = captureLongStructureMutationTarget(expectedBookId);
    if (!target)
      return {
        message: t(
          "longBookLifecycleCoordinator.theCurrentNovelStructureIsNotReady"
        )
      };
    if (activeMutation || longBookActionPending.value) {
      return {
        message: t("lease.anotherLongFormStructureChangeIsStillBeingProcessed")
      };
    }
    const lease: LongStructureMutationLease = {
      requestId: ++mutationRequestEpoch,
      target,
      applied: false
    };
    activeMutation = lease;
    if (blockUi) longBookActionPending.value = true;
    return { lease };
  }
  async function runWithMutationLease(
    lease: LongStructureMutationLease,
    task: () => Promise<void>
  ): Promise<void> {
    const operation = Promise.resolve().then(task);
    inFlightOperations.add(operation);
    try {
      await operation;
    } finally {
      inFlightOperations.delete(operation);
      if (activeMutation === lease) {
        activeMutation = null;
        longBookActionPending.value = false;
      }
    }
  }
  async function withMutation(
    expectedBookId: string | null | undefined,
    onRejected: (message: string) => void,
    task: (lease: LongStructureMutationLease) => Promise<void>,
    options: { blockUi?: boolean } = {}
  ): Promise<void> {
    const acquired = acquireMutation(expectedBookId, options.blockUi !== false);
    if (!acquired) return;
    if ("message" in acquired) {
      onRejected(acquired.message);
      return;
    }
    await runWithMutationLease(acquired.lease, () => task(acquired.lease));
  }
  async function runTracked<T>(task: () => Promise<T>): Promise<T> {
    const operation = Promise.resolve().then(task);
    inFlightOperations.add(operation);
    try {
      return await operation;
    } finally {
      inFlightOperations.delete(operation);
    }
  }
  function beginDialogRequest(): number | null {
    if (disposed) return null;
    return ++dialogRequestEpoch;
  }
  function dialogRequestIsCurrent(requestId: number): boolean {
    return !disposed && dialogRequestEpoch === requestId;
  }
  function cancelDialogRequests(): void {
    dialogRequestEpoch += 1;
  }
  function clearDialog<T>(target: { value: T }, next: T): void {
    cancelDialogRequests();
    target.value = next;
  }
  const closeLongStructureDialog = () =>
    clearDialog(longStructureDialogOpen, false);
  const closeLongCharacterCreate = () => clearDialog(longCharacterCreate, null);
  const closeLongWorldbuildingItemCreate = () =>
    clearDialog(longWorldbuildingItemCreate, null);
  const closeLongPlotPointCreate = () => clearDialog(longPlotPointCreate, null);
  const closeLongChapterCardCreate = () =>
    clearDialog(longChapterCardCreate, null);
  const closeLongDraftSectionDelete = () =>
    clearDialog(longDraftSectionDelete, null);
  const closeLongTreeItemDelete = () => clearDialog(longTreeItemDelete, null);
  const closeLongVolumeCreate = () => clearDialog(longVolumeCreate, null);
  async function drain(): Promise<void> {
    while (inFlightOperations.size > 0) {
      await Promise.allSettled([...inFlightOperations]);
    }
  }
  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    if (disposed) return;
    disposed = true;
    mutationRequestEpoch += 1;
    dialogRequestEpoch += 1;
    disposePromise = (async () => {
      await drain();
      longBookActionPending.value = false;
    })();
    await disposePromise;
  }
  return {
    uiMessage,
    resources: options.resources,
    session,
    state,
    resolveLongWorkspaceApi: options.api,
    isDisposed,
    captureLongStructureMutationTarget,
    mutationIsCurrent,
    assertCurrentLongStructureMutationTarget,
    acquireMutation,
    runWithMutationLease,
    withMutation,
    runTracked,
    beginDialogRequest,
    dialogRequestIsCurrent,
    cancelDialogRequests,
    closeLongStructureDialog,
    closeLongCharacterCreate,
    closeLongWorldbuildingItemCreate,
    closeLongPlotPointCreate,
    closeLongChapterCardCreate,
    closeLongDraftSectionDelete,
    closeLongTreeItemDelete,
    closeLongVolumeCreate,
    drain,
    dispose
  };
}

export type LongStructureLease = ReturnType<typeof createLongStructureLease>;
