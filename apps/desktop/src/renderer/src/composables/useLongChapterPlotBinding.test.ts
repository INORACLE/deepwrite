import { effectScope, nextTick, shallowRef, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  previewLongWorkspaceOperations,
  type LongWorkspaceImpactConfirmation,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { workspace } from "../../../../../../packages/contracts/src/long-workspace-operations.test-support";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";
import { useLongChapterPlotBinding } from "./useLongChapterPlotBinding";

function harness() {
  const index = shallowRef(workspace());
  index.value.plot.arcs.push({
    ...index.value.plot.arcs[0]!,
    id: "arc_next",
    title: "下一剧情点",
    order: 2
  });
  const chapterId = ref("chapter_one");
  const previews: {
    batch: LongWorkspaceOperationBatch;
    done: (impact?: LongWorkspaceImpactConfirmation) => void;
  }[] = [];
  const mutations: {
    batch: LongWorkspaceOperationBatch;
    done: LongStructureMutationCompletion;
  }[] = [];
  const warn = vi.fn();
  const scope = effectScope();
  const binding = scope.run(() =>
    useLongChapterPlotBinding({
      bookId: () => index.value.bookId,
      chapterCardId: () => chapterId.value,
      snapshot: () => index.value,
      locked: () => false,
      preview: (batch, done) => previews.push({ batch, done }),
      mutate: (batch, done) => mutations.push({ batch, done }),
      warn
    })
  )!;
  const resolvePreview = (position: number) => {
    const preview = previews[position]!;
    const result = previewLongWorkspaceOperations(index.value, preview.batch);
    preview.done(result.confirmation);
    return result;
  };
  return {
    index,
    chapterId,
    previews,
    mutations,
    warn,
    scope,
    binding,
    resolvePreview
  };
}

describe("chapter plot binding form", () => {
  it("previews and confirms a cloneable batch, preserving chapter order", async () => {
    const h = harness();
    h.binding.edit();
    await nextTick();
    expect(h.previews).toHaveLength(0);
    h.binding.primaryArcId.value = "arc_next";
    await nextTick();
    h.binding.submit();
    expect(h.mutations).toHaveLength(0);
    h.resolvePreview(0);
    h.binding.submit();
    expect(h.mutations).toHaveLength(1);
    const mutation = h.mutations[0]!;
    expect(() => structuredClone(mutation.batch)).not.toThrow();
    expect(mutation.batch.operations).toMatchObject([
      { type: "chapter.move", beforeChapterCardId: "chapter_two" }
    ]);
    expect(mutation.batch.expectedImpact).toBeTruthy();
    expect(h.index.value.plot.chapterCards[0]?.primaryArcId).toBe("arc_letter");
    mutation.done.succeed();
    expect(h.binding.open.value).toBe(false);
    h.scope.stop();
  });

  it("discards stale previews and old completion callbacks when switching chapters", async () => {
    const h = harness();
    h.binding.edit();
    h.binding.primaryArcId.value = "arc_next";
    await nextTick();
    h.binding.primaryArcId.value = "";
    await nextTick();
    h.resolvePreview(0);
    expect(h.binding.prepared.value).toBeNull();
    h.resolvePreview(1);
    h.binding.submit();
    const old = h.mutations[0]!;
    h.chapterId.value = "chapter_two";
    expect(h.binding.open.value).toBe(false);
    h.binding.edit();
    old.done.fail("旧请求失败");
    expect(h.binding.open.value).toBe(true);
    expect(h.binding.pending.value).toBe(false);
    h.scope.stop();
  });

  it("requires a new review after changed impact and leaves failed saves editable", async () => {
    const h = harness();
    h.binding.edit();
    h.binding.primaryArcId.value = "";
    await nextTick();
    const preview = h.resolvePreview(0);
    h.binding.submit();
    h.binding.close();
    expect(h.binding.open.value).toBe(true);
    h.mutations[0]!.done.fail("关系变化", preview.confirmation);
    expect(h.binding.pending.value).toBe(false);
    h.binding.submit();
    expect(h.mutations).toHaveLength(2);
    h.mutations[1]!.done.fail("保存失败");
    expect(h.binding.prepared.value).toBeNull();
    expect(h.binding.previewPending.value).toBe(true);
    h.binding.close();
    h.resolvePreview(1);
    expect(h.binding.prepared.value).toBeNull();
    h.scope.stop();
  });
});
