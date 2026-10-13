import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ComposerReferenceOption } from "../types/conversation";
import { useConversationComposer } from "./useConversationComposer";

function createHarness() {
  const scope = effectScope();
  const draft = ref("");
  const materials = Array.from({ length: 80 }, (_, index) => ({
    id: `material-${index}`,
    label: `综合素材 · 素材${index}`,
    detail: "当前作品已绑定"
  }));
  const availableMaterials = ref<ComposerReferenceOption[]>(materials);
  const emitSend = vi.fn();
  const composer = scope.run(() =>
    useConversationComposer({
      draft: () => draft.value,
      canSend: () => true,
      canSendAttachments: () => true,
      runtimeAvailable: () => true,
      libraryDomain: () => undefined,
      availableSkills: () => [],
      availableMaterials: () => availableMaterials.value,
      availableTeamMembers: () => null,
      editorReferences: () => [],
      textAttachmentMaxCharacters: () => 50_000,
      textAttachmentsTotalMaxCharacters: () => 57_600,
      pendingAttachments: ref([]),
      readingAttachments: ref(false),
      emitDraft: (value) => {
        draft.value = value;
      },
      emitSend,
      emitClearEditorReferences: vi.fn()
    })
  )!;
  const input = (value: string) => {
    draft.value = value;
    composer.updateActiveReference({
      value,
      selectionStart: value.length
    } as HTMLTextAreaElement);
  };
  const key = (value: string) =>
    composer.handleKeydown({
      key: value,
      isComposing: false,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent);
  return { composer, scope, draft, emitSend, availableMaterials, input, key };
}

describe("composer material references", () => {
  it("lists all materials and can search and insert entries after the twelfth result", async () => {
    const test = createHarness();
    try {
      test.input("@");
      expect(test.composer.filteredReferenceOptions.value).toHaveLength(80);
      test.input("@素材");
      expect(test.composer.filteredReferenceOptions.value).toHaveLength(80);
      test.input("@素材79");
      expect(
        test.composer.filteredReferenceOptions.value.map(({ id }) => id)
      ).toEqual(["material-79"]);
      test.key("Enter");
      await nextTick();
      expect(test.draft.value).toBe("@综合素材 · 素材79 ");
      expect(test.composer.activeReference.value).toBeNull();
      expect(test.emitSend).not.toHaveBeenCalled();
    } finally {
      test.scope.stop();
    }
  });

  it("navigates beyond twelve results and reconciles selection after filtering", async () => {
    const test = createHarness();
    // Keyboard navigation schedules a DOM scroll after Vue updates.
    vi.stubGlobal("document", { getElementById: () => null });
    try {
      test.input("@");
      for (let index = 0; index < 13; index++) test.key("ArrowDown");
      expect(test.composer.activeReferenceIndex.value).toBe(13);
      await nextTick();
      test.input("@素材79");
      await nextTick();
      expect(test.composer.activeReferenceIndex.value).toBe(0);
      test.key("Tab");
      await nextTick();
      expect(test.draft.value).toBe("@综合素材 · 素材79 ");
    } finally {
      await nextTick();
      test.scope.stop();
      vi.unstubAllGlobals();
    }
  });
});
