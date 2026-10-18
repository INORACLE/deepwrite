import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { UserPromptAttachment } from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import { useConversationComposer } from "./useConversationComposer";

function textAttachment(id: string, length: number): UserPromptAttachment {
  return {
    id,
    kind: "text",
    name: `${id}.txt`,
    mediaType: "text/plain",
    size: length,
    content: "字".repeat(length)
  };
}

describe("conversation composer attachment budget", () => {
  it("checks the combined message and attachments against the configured budget", () => {
    const scope = effectScope();
    const draft = ref("字".repeat(40_000));
    const pendingAttachments = ref<UserPromptAttachment[]>([
      textAttachment("source", 30_000)
    ]);
    const emitSend = vi.fn();
    const warning = vi.spyOn(uiMessage, "warning").mockReturnValue(-1);
    const composer = scope.run(() =>
      useConversationComposer({
        draft: () => draft.value,
        canSend: () => true,
        canSendAttachments: () => true,
        runtimeAvailable: () => true,
        libraryDomain: () => "skill",
        availableSkills: () => [],
        availableMaterials: () => [],
        availableTeamMembers: () => null,
        editorReferences: () => [],
        textAttachmentMaxCharacters: () => 50_000,
        textAttachmentsTotalMaxCharacters: () => 57_600,
        contextCompactionBudgetTokens: () => 64_000,
        pendingAttachments,
        readingAttachments: ref(false),
        emitDraft: vi.fn(),
        emitSend,
        emitClearEditorReferences: vi.fn()
      })
    )!;
    try {
      composer.submitMessage();
      expect(emitSend).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("超过当前可用的 57,600 token")
      );
      expect(pendingAttachments.value).toHaveLength(1);
      draft.value = "请阅读附件";
      composer.submitMessage();
      expect(emitSend).toHaveBeenCalledOnce();
    } finally {
      scope.stop();
      warning.mockRestore();
    }
  });

  it("warns before clearing attachments and editor references for an overlong message", () => {
    const scope = effectScope();
    const draft = ref("字".repeat(57_601));
    const budgetTokens = ref(64_000);
    const pendingAttachments = ref<UserPromptAttachment[]>([
      textAttachment("reference", 12)
    ]);
    const emitSend = vi.fn();
    const emitDraft = vi.fn();
    const emitClearEditorReferences = vi.fn();
    const warning = vi.spyOn(uiMessage, "warning").mockReturnValue(-1);
    const composer = scope.run(() =>
      useConversationComposer({
        draft: () => draft.value,
        canSend: () => true,
        canSendAttachments: () => true,
        runtimeAvailable: () => true,
        libraryDomain: () => "skill",
        availableSkills: () => [],
        availableMaterials: () => [],
        availableTeamMembers: () => null,
        editorReferences: () => [
          {
            id: "selection",
            resourceId: "skill-library",
            documentId: "skill-1",
            documentTitle: "写作方法",
            documentPath: ["技能库", "写作方法"],
            text: "选中的技能正文",
            start: 0,
            end: 8,
            startLine: 1,
            endLine: 1,
            label: "写作方法 (1-1)"
          }
        ],
        textAttachmentMaxCharacters: () => 50_000,
        textAttachmentsTotalMaxCharacters: () => 57_600,
        contextCompactionBudgetTokens: () => budgetTokens.value,
        pendingAttachments,
        readingAttachments: ref(false),
        emitDraft,
        emitSend,
        emitClearEditorReferences
      })
    )!;
    try {
      composer.submitMessage();
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("超过当前可用的 57,600 token")
      );
      expect(emitSend).not.toHaveBeenCalled();
      expect(emitDraft).not.toHaveBeenCalled();
      expect(emitClearEditorReferences).not.toHaveBeenCalled();
      expect(pendingAttachments.value).toEqual([
        textAttachment("reference", 12)
      ]);

      budgetTokens.value = 128_000;
      composer.submitMessage();
      expect(warning).toHaveBeenCalledOnce();
      expect(emitSend).toHaveBeenCalledWith([
        textAttachment("reference", 12),
        expect.objectContaining({ content: "选中的技能正文" })
      ]);
      expect(emitClearEditorReferences).toHaveBeenCalledOnce();
      expect(pendingAttachments.value).toEqual([]);
    } finally {
      scope.stop();
      warning.mockRestore();
    }
  });

  it("blocks combined attachments above the working budget cap and sends a smaller set", () => {
    const scope = effectScope();
    const pendingAttachments = ref<UserPromptAttachment[]>([
      textAttachment("first", 30_000),
      textAttachment("second", 30_000)
    ]);
    const emitSend = vi.fn();
    const warning = vi.spyOn(uiMessage, "warning").mockReturnValue(-1);
    const composer = scope.run(() =>
      useConversationComposer({
        draft: () => "请阅读附件",
        canSend: () => true,
        canSendAttachments: () => true,
        runtimeAvailable: () => true,
        libraryDomain: () => undefined,
        availableSkills: () => [],
        availableMaterials: () => [],
        availableTeamMembers: () => null,
        editorReferences: () => [],
        textAttachmentMaxCharacters: () => 50_000,
        textAttachmentsTotalMaxCharacters: () => 57_600,
        pendingAttachments,
        readingAttachments: ref(false),
        emitDraft: vi.fn(),
        emitSend,
        emitClearEditorReferences: vi.fn()
      })
    )!;

    try {
      composer.submitMessage();
      expect(emitSend).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("57,600"));
      expect(pendingAttachments.value).toHaveLength(2);

      pendingAttachments.value = pendingAttachments.value.slice(0, 1);
      composer.submitMessage();
      expect(emitSend).toHaveBeenCalledWith([
        expect.objectContaining({ id: "first" })
      ]);
      expect(pendingAttachments.value).toEqual([]);
    } finally {
      scope.stop();
      warning.mockRestore();
    }
  });
});

function referenceComposer(teamMembers: ReturnType<typeof teamOptions>) {
  const draft = ref("");
  const scope = effectScope();
  const composer = scope.run(() =>
    useConversationComposer({
      draft: () => draft.value,
      canSend: () => true,
      canSendAttachments: () => true,
      runtimeAvailable: () => true,
      libraryDomain: () => undefined,
      availableSkills: () => [{ id: "s1", label: "节奏", detail: "技能" }],
      availableMaterials: () => [{ id: "m1", label: "人物", detail: "素材" }],
      availableTeamMembers: () => teamMembers.value,
      editorReferences: () => [],
      textAttachmentMaxCharacters: () => 50_000,
      textAttachmentsTotalMaxCharacters: () => 57_600,
      pendingAttachments: ref([]),
      readingAttachments: ref(false),
      emitDraft: (value) => {
        draft.value = value;
      },
      emitSend: vi.fn(),
      emitClearEditorReferences: vi.fn()
    })
  )!;
  return { composer, scope, draft };
}

function teamOptions(
  value: { id: string; label: string; detail: string }[] | null
) {
  return ref(value);
}

function typeInto(
  composer: ReturnType<typeof useConversationComposer>,
  value: string
): void {
  composer.handleInput({
    target: { value, selectionStart: value.length }
  } as unknown as Event);
}

describe("conversation composer team member references", () => {
  const members = [
    { id: "polisher", label: "文风润色师", detail: "统一文风" },
    { id: "checker", label: "连续性检查员", detail: "检查设定冲突" }
  ];

  it("opens the member list on # only while team mode is on", () => {
    const team = referenceComposer(teamOptions(members));
    const normal = referenceComposer(teamOptions(null));
    try {
      typeInto(team.composer, "请 #");
      expect(team.composer.activeReference.value?.trigger).toBe("#");
      expect(
        team.composer.filteredReferenceOptions.value.map((option) => option.id)
      ).toEqual(["polisher", "checker"]);
      expect(team.composer.referenceMenuTitle.value).toBe("指派团队成员");

      typeInto(normal.composer, "请 #");
      expect(normal.composer.activeReference.value).toBeNull();
      typeInto(normal.composer, "/节");
      expect(normal.composer.activeReference.value?.trigger).toBe("/");
    } finally {
      team.scope.stop();
      normal.scope.stop();
    }
  });

  it("filters members by name or description and inserts the chosen name", () => {
    const { composer, scope, draft } = referenceComposer(teamOptions(members));
    try {
      typeInto(composer, "请 #检查");
      expect(
        composer.filteredReferenceOptions.value.map((option) => option.id)
      ).toEqual(["checker"]);
      composer.selectReference(composer.filteredReferenceOptions.value[0]!);
      expect(draft.value).toBe("请 #连续性检查员 ");
      expect(composer.activeReference.value).toBeNull();
    } finally {
      scope.stop();
    }
  });

  it("keeps skills on / and materials on @ when team mode is on", () => {
    const { composer, scope } = referenceComposer(teamOptions(members));
    try {
      typeInto(composer, "@人");
      expect(
        composer.referenceOptions.value.map((option) => option.id)
      ).toEqual(["m1"]);
      typeInto(composer, "/节");
      expect(
        composer.referenceOptions.value.map((option) => option.id)
      ).toEqual(["s1"]);
    } finally {
      scope.stop();
    }
  });

  it("mentions # in the placeholder only in team mode and closes the menu when team mode ends", async () => {
    const teamMembers = teamOptions(members);
    const { composer, scope } = referenceComposer(teamMembers);
    try {
      expect(composer.composerPlaceholder.value).toContain("# 指派团队成员");
      typeInto(composer, "#");
      expect(composer.activeReference.value?.trigger).toBe("#");

      teamMembers.value = null;
      await nextTick();
      expect(composer.activeReference.value).toBeNull();
      expect(composer.composerPlaceholder.value).not.toContain("#");
    } finally {
      scope.stop();
    }
  });
});
