import {
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema,
  type LongBookSummary,
  type LongWorkspaceImpactConfirmation,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { computed, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import { createLongStructureMutationBuilder } from "../types/longStructureMutations";
import {
  useLongStructureTransactionsCoordinator,
  type LongStructureTransactionsCoordinatorOptions
} from "./useLongStructureTransactionsCoordinator";

const NOW = "2026-08-14T08:00:00.000Z";
const BOOK_ID = "longbook_structure_alpha";
const EMPTY_CONFIRMATION: LongWorkspaceImpactConfirmation = {
  impact: {
    createdEntityIds: [],
    updatedEntityIds: [],
    deletedEntityIds: [],
    createdFileIds: [],
    deletedFileIds: [],
    documentWriteProposalIds: []
  },
  entityChanges: [],
  relationshipChanges: [],
  fileIntents: [],
  ledgerRecordEdits: []
};
const DESTRUCTIVE_CONFIRMATION: LongWorkspaceImpactConfirmation = {
  ...EMPTY_CONFIRMATION,
  impact: {
    ...EMPTY_CONFIRMATION.impact,
    deletedEntityIds: ["worlditem_rule_one"]
  },
  entityChanges: [
    {
      id: "worlditem_rule_one",
      kind: "worldbuilding-item",
      action: "delete",
      before: { id: "worlditem_rule_one", title: "第一条规则" },
      after: null
    }
  ]
};

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function workspaceIndex(bookId = BOOK_ID): LongWorkspaceIndexSnapshot {
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId,
    updatedAt: NOW,
    bookLine: {
      id: LONG_BOOK_LINE_FILE_ID,
      path: "long/plot/book-line.md",
      updatedAt: NOW
    },
    worldbuilding: [],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [{ id: "volume_one", title: "第一卷", order: 1, summary: "" }],
      arcs: [],
      chapterCards: [],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [],
    ledger: { committedThroughChapterId: null, commits: [] }
  });
}

function bookSummary(bookId = BOOK_ID): LongBookSummary {
  return {
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: bookId,
    title: `长篇 ${bookId}`,
    bookType: "long",
    genre: "测试",
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
    createdAt: NOW,
    updatedAt: NOW,
    navigation: {
      schemaVersion: 1,
      bookId,
      updatedAt: NOW,
      worldbuilding: [],
      characterTypes: [],
      characters: [],
      volumes: [],
      arcs: [],
      chapterCards: [],
      counts: {
        worldbuildingCategories: 0,
        characters: 0,
        arcs: 0,
        volumes: 0,
        chapterCards: 0,
        foreshadowingThreads: 0,
        committedChapters: 0,
        storyEvents: 0,
        storyPlots: 0
      },
      committedThroughChapterId: null
    }
  };
}

function mutationBatch(
  index: LongWorkspaceIndexSnapshot
): LongWorkspaceOperationBatch {
  return createLongStructureMutationBuilder(index).createVolume({
    title: "第二卷",
    summary: ""
  });
}

function createHarness(
  overrides: {
    previewOperations?: LongWorkspaceRendererApi["previewOperations"];
    applyOperations?: LongWorkspaceRendererApi["applyOperations"];
    saveActiveEditorChanges?: () => Promise<boolean>;
    refreshActiveWorkspace?: (bookId: string) => Promise<boolean>;
    refreshWorkspaceAfterProposal?: (bookId: string) => Promise<boolean>;
  } = {}
) {
  const activeLongBookId = ref<string | null>(BOOK_ID);
  const activeLongWorkspaceIndex =
    shallowRef<LongWorkspaceIndexSnapshot | null>(workspaceIndex());
  const longBooks = shallowRef<readonly LongBookSummary[]>([bookSummary()]);
  const activeLongBookSummary = computed(
    () =>
      longBooks.value.find(({ id }) => id === activeLongBookId.value) ?? null
  );
  const previewOperations = vi.fn(
    overrides.previewOperations ??
      (async ({ bookId }) =>
        ({
          bookId,
          preview: {
            impact: {
              createdEntityIds: [],
              updatedEntityIds: [],
              deletedEntityIds: [],
              createdFileIds: [],
              deletedFileIds: [],
              documentWriteProposalIds: []
            },
            entityChanges: [],
            relationshipChanges: [],
            fileIntents: [],
            ledgerRecordEdits: [],
            confirmation: {
              impact: {
                createdEntityIds: [],
                updatedEntityIds: [],
                deletedEntityIds: [],
                createdFileIds: [],
                deletedFileIds: [],
                documentWriteProposalIds: []
              },
              entityChanges: [],
              relationshipChanges: [],
              fileIntents: [],
              ledgerRecordEdits: []
            },
            documentWrites: [],
            provisionalIdMap: {}
          }
        }) as never)
  );
  const applyOperations = vi.fn(
    overrides.applyOperations ??
      (async ({ bookId }) =>
        ({
          bookId,
          summary: bookSummary(bookId),
          operationResult: {}
        }) as never)
  );
  const api = {
    previewOperations,
    applyOperations,
    getWorkspaceIndex: vi.fn(),
    readDocument: vi.fn()
  } as unknown as LongWorkspaceRendererApi;
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const refreshWorkspaceAfterProposal = vi.fn(
    overrides.refreshWorkspaceAfterProposal ?? (async () => true)
  );
  const options: LongStructureTransactionsCoordinatorOptions = {
    api: () => api,
    state: {
      longBooks,
      activeBookId: activeLongBookId,
      activeBookSummary: activeLongBookSummary,
      workspaceIndex: activeLongWorkspaceIndex,
      selection: shallowRef(null),
      mutationPending: ref(false),
      structureDialogOpen: ref(true),
      characterCreateTarget: shallowRef(null),
      worldbuildingItemCreateTarget: shallowRef(null),
      plotPointCreateTarget: shallowRef(null),
      chapterCardCreateTarget: shallowRef(null),
      draftSectionDeleteTarget: shallowRef(null),
      treeItemDeleteTarget: shallowRef(null),
      volumeCreateTarget: shallowRef(null),
      selectedResourceId: ref("")
    },
    session: {
      saveActiveEditorChanges: vi.fn(
        overrides.saveActiveEditorChanges ?? (async () => true)
      ),
      saveActiveEditorBeforeLeaving: vi.fn(async () => true),
      openBook: vi.fn(async () => undefined),
      refreshActiveWorkspace: vi.fn(
        overrides.refreshActiveWorkspace ?? (async () => true)
      ),
      refreshWorkspaceAfterProposal,
      selectWorkspaceFile: vi.fn(async () => true),
      selectChapterCardTab: vi.fn(async () => undefined),
      editor: shallowRef(null)
    },
    resources: {
      node: vi.fn(() => undefined),
      select: vi.fn(async () => undefined),
      synchronizeSelectedResourceForLayout: vi.fn(),
      revealEditor: vi.fn()
    },
    notifications
  };
  const coordinator = useLongStructureTransactionsCoordinator(options);
  return {
    ...options.state,
    api,
    applyOperations,
    coordinator,
    notifications,
    previewOperations,
    refreshWorkspaceAfterProposal
  };
}

function completion() {
  return {
    succeed: vi.fn(),
    fail: vi.fn(),
    appliedButRefreshFailed: vi.fn()
  };
}

describe("useLongStructureTransactionsCoordinator", () => {
  it("saves reordering without disabling unrelated controls and still serializes mutations", async () => {
    const pendingApply = deferred<never>();
    const harness = createHarness({
      applyOperations: vi.fn(() => pendingApply.promise)
    });
    const batch = {
      updatedAt: "2026-07-26T13:00:00.000Z",
      operations: [
        {
          type: "volume.reorder" as const,
          orderedIds: harness.workspaceIndex.value!.plot.volumes.map(
            ({ id }) => id
          )
        }
      ],
      documentWrites: []
    };
    const result = completion();
    const request = harness.coordinator.handleActiveLongStructureMutation(
      batch,
      result
    );
    await vi.waitFor(() =>
      expect(harness.applyOperations).toHaveBeenCalledOnce()
    );
    expect(harness.mutationPending.value).toBe(false);
    const duplicate = completion();
    await harness.coordinator.handleActiveLongStructureMutation(
      batch,
      duplicate
    );
    expect(duplicate.fail).toHaveBeenCalledOnce();
    pendingApply.resolve({
      bookId: BOOK_ID,
      summary: bookSummary(BOOK_ID),
      operationResult: {}
    } as never);
    await request;
    expect(result.succeed).toHaveBeenCalledOnce();
    expect(harness.mutationPending.value).toBe(false);
  });

  it("single-flights duplicate submissions", async () => {
    const pendingApply = deferred<never>();
    const harness = createHarness({
      applyOperations: vi.fn(() => pendingApply.promise)
    });
    const firstCompletion = completion();
    const duplicateCompletion = completion();
    const batch = mutationBatch(harness.workspaceIndex.value!);

    const first = harness.coordinator.handleActiveLongStructureMutation(
      batch,
      firstCompletion
    );
    await vi.waitFor(() => {
      expect(harness.applyOperations).toHaveBeenCalledTimes(1);
    });
    const duplicate = harness.coordinator.handleActiveLongStructureMutation(
      batch,
      duplicateCompletion
    );

    expect(duplicateCompletion.fail).toHaveBeenCalledWith(
      "另一项长篇结构修改仍在处理中。"
    );
    pendingApply.resolve({
      bookId: BOOK_ID,
      summary: bookSummary(BOOK_ID),
      operationResult: {}
    } as never);
    await Promise.all([first, duplicate]);
    expect(firstCompletion.succeed).toHaveBeenCalledTimes(1);
  });

  it("does not publish a late apply result into a different active book", async () => {
    const pendingApply = deferred<never>();
    const harness = createHarness({
      applyOperations: vi.fn(() => pendingApply.promise)
    });
    const result = completion();
    const request = harness.coordinator.handleActiveLongStructureMutation(
      mutationBatch(harness.workspaceIndex.value!),
      result
    );
    await flushMicrotasks();

    const otherBookId = "longbook_structure_beta";
    harness.activeBookId.value = otherBookId;
    harness.longBooks.value = [bookSummary(otherBookId)];
    harness.workspaceIndex.value = workspaceIndex(otherBookId);
    pendingApply.resolve({
      bookId: BOOK_ID,
      summary: bookSummary(BOOK_ID),
      operationResult: {}
    } as never);
    await request;

    expect(result.succeed).not.toHaveBeenCalled();
    expect(result.appliedButRefreshFailed).toHaveBeenCalledTimes(1);
    expect(harness.longBooks.value.map(({ id }) => id)).toEqual([otherBookId]);
    expect(harness.refreshWorkspaceAfterProposal).not.toHaveBeenCalled();
  });

  it("saves the editor before previewing and applies without version fields", async () => {
    const save = vi.fn(async () => {
      harness.workspaceIndex.value = workspaceIndex(BOOK_ID);
      harness.longBooks.value = [bookSummary(BOOK_ID)];
      return true;
    });
    const harness = createHarness({ saveActiveEditorChanges: save });
    const initialIndex = harness.workspaceIndex.value!;
    const result = completion();

    await harness.coordinator.handleActiveLongStructureMutation(
      mutationBatch(initialIndex),
      result
    );

    expect(harness.previewOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: BOOK_ID
      })
    );
    expect(harness.applyOperations).toHaveBeenCalledWith(
      expect.not.objectContaining({ baseProjectRevision: expect.anything() })
    );
    expect(result.succeed).toHaveBeenCalledTimes(1);
  });

  it("previews manual structure deletion locally without waiting for Core", async () => {
    const harness = createHarness({
      previewOperations: vi.fn(() => new Promise<never>(() => undefined))
    });
    const completion = vi.fn();
    const batch = createLongStructureMutationBuilder(
      harness.workspaceIndex.value!
    ).deleteVolume("volume_one");

    await harness.coordinator.previewActiveLongStructureMutation(
      batch,
      completion
    );

    expect(harness.previewOperations).not.toHaveBeenCalled();
    expect(completion).toHaveBeenCalledTimes(1);
    expect(completion.mock.calls[0]?.[0]).toMatchObject({
      impact: {
        deletedEntityIds: expect.arrayContaining(["volume_one"])
      }
    });
  });

  it("releases a structure mutation when the final Core preview stalls", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness({
        previewOperations: vi.fn(() => new Promise<never>(() => undefined))
      });
      const result = completion();
      const request = harness.coordinator.handleActiveLongStructureMutation(
        mutationBatch(harness.workspaceIndex.value!),
        result
      );
      await flushMicrotasks();

      expect(harness.mutationPending.value).toBe(true);
      await vi.advanceTimersByTimeAsync(15_000);
      await request;

      expect(harness.applyOperations).not.toHaveBeenCalled();
      expect(result.fail.mock.calls[0]?.[0]).toBe(
        "核对长篇结构影响超时，请重试。"
      );
      expect(harness.notifications.error).toHaveBeenCalledWith(
        "核对长篇结构影响超时，请重试。"
      );
      expect(harness.mutationPending.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never applies an unconfirmed explicit delete even when preview misses its effects", async () => {
    const harness = createHarness();
    const result = completion();
    const batch = createLongStructureMutationBuilder(
      harness.workspaceIndex.value!
    ).deleteVolume("volume_one");

    await harness.coordinator.handleActiveLongStructureMutation(batch, result);

    expect(harness.previewOperations).toHaveBeenCalledTimes(1);
    expect(harness.applyOperations).not.toHaveBeenCalled();
    expect(result.fail).toHaveBeenCalledWith(
      "请先核对关联关系与删除影响，再确认执行。",
      EMPTY_CONFIRMATION
    );
  });

  it("requires confirmation for destructive effects hidden behind an update", async () => {
    const harness = createHarness({
      previewOperations: vi.fn(
        async ({ bookId }) =>
          ({
            bookId,
            preview: {
              ...DESTRUCTIVE_CONFIRMATION,
              confirmation: DESTRUCTIVE_CONFIRMATION,
              documentWrites: [],
              provisionalIdMap: {}
            }
          }) as never
      )
    });
    const result = completion();
    const batch: LongWorkspaceOperationBatch = {
      updatedAt: NOW,
      operations: [
        {
          type: "worldbuilding.update",
          id: "world_rules",
          patch: { format: "text" }
        }
      ],
      documentWrites: []
    };

    await harness.coordinator.handleActiveLongStructureMutation(batch, result);

    expect(harness.applyOperations).not.toHaveBeenCalled();
    expect(result.fail).toHaveBeenCalledWith(
      "请先核对关联关系与删除影响，再确认执行。",
      DESTRUCTIVE_CONFIRMATION
    );

    await harness.coordinator.handleActiveLongStructureMutation(
      { ...batch, expectedImpact: DESTRUCTIVE_CONFIRMATION },
      result
    );
    expect(harness.applyOperations).toHaveBeenCalledWith({
      bookId: BOOK_ID,
      batch: expect.objectContaining({
        expectedImpact: DESTRUCTIVE_CONFIRMATION
      })
    });
  });

  it("rejects a batch when the target changes after preview", async () => {
    const pendingPreview = deferred<never>();
    const harness = createHarness({
      previewOperations: vi.fn(() => pendingPreview.promise)
    });
    const result = completion();
    const request = harness.coordinator.handleActiveLongStructureMutation(
      mutationBatch(harness.workspaceIndex.value!),
      result
    );
    await flushMicrotasks();
    harness.workspaceIndex.value = workspaceIndex(BOOK_ID);
    pendingPreview.resolve({
      bookId: BOOK_ID,
      preview: {}
    } as never);
    await request;

    expect(harness.applyOperations).not.toHaveBeenCalled();
    expect(result.fail).toHaveBeenCalledTimes(1);
    expect(result.succeed).not.toHaveBeenCalled();
  });

  it("drains an issued apply during dispose and suppresses late UI publication", async () => {
    const pendingApply = deferred<never>();
    const harness = createHarness({
      applyOperations: vi.fn(() => pendingApply.promise)
    });
    const result = completion();
    const request = harness.coordinator.handleActiveLongStructureMutation(
      mutationBatch(harness.workspaceIndex.value!),
      result
    );
    await flushMicrotasks();

    let disposed = false;
    const dispose = harness.coordinator.dispose().then(() => {
      disposed = true;
    });
    await flushMicrotasks();
    expect(disposed).toBe(false);
    pendingApply.resolve({
      bookId: BOOK_ID,
      summary: bookSummary(BOOK_ID),
      operationResult: {}
    } as never);
    await Promise.all([request, dispose]);

    expect(result.succeed).not.toHaveBeenCalled();
    expect(result.fail).not.toHaveBeenCalled();
    expect(result.appliedButRefreshFailed).not.toHaveBeenCalled();
    expect(harness.refreshWorkspaceAfterProposal).not.toHaveBeenCalled();
    expect(harness.notifications.success).not.toHaveBeenCalled();
    expect(harness.mutationPending.value).toBe(false);
  });

  it("reports an applied mutation separately when refresh fails", async () => {
    const harness = createHarness({
      refreshWorkspaceAfterProposal: vi.fn(async () => false)
    });
    const result = completion();

    await harness.coordinator.handleActiveLongStructureMutation(
      mutationBatch(harness.workspaceIndex.value!),
      result
    );

    expect(result.succeed).not.toHaveBeenCalled();
    expect(result.fail).not.toHaveBeenCalled();
    expect(result.appliedButRefreshFailed).toHaveBeenCalledWith(
      "结构修改已保存，但界面未能同步最新结构。"
    );
    expect(harness.structureDialogOpen.value).toBe(false);
  });
});
