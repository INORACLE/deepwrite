import { createPinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { WorkspaceDocument } from "../types/workspace";
import RightEditorPane from "./RightEditorPane.vue";

type EditorProps = InstanceType<typeof RightEditorPane>["$props"];

async function renderEditor(
  document: WorkspaceDocument,
  overrides: Partial<EditorProps> = {}
) {
  const app = createSSRApp(RightEditorPane, {
    document,
    resourceId: document.id,
    draftState: { title: document.title, content: "修改后的正文", dirty: true },
    locked: false,
    defaultViewMode: "edit",
    entrySearchItems: [],
    ...overrides
  });
  app.use(createPinia());
  const html = await renderToString(app);
  return html.match(
    /<button[^>]*class="save-button"[^>]*>[\s\S]*?<\/button>/
  )?.[0];
}

describe.each(["short", "script", "material", "skill"] as const)(
  "%s editor save action",
  (kind) => {
    const document: WorkspaceDocument = {
      id: `document-${kind}`,
      domain: kind === "short" || kind === "script" ? "creation" : kind,
      ...(kind === "short" || kind === "script" ? { workspaceType: kind } : {}),
      title: "文稿",
      eyebrow: "正文",
      path: ["文稿"],
      content: "初稿"
    };

    it.each([{}, { saving: true }, { manualSaving: true }])(
      "hides the manual save action throughout auto-save (%j)",
      async (saving) => {
        expect(
          await renderEditor(document, { autoSaveEnabled: true, ...saving })
        ).toBeUndefined();
      }
    );

    it("offers Save now for unsaved edits when auto-save is off", async () => {
      const button = await renderEditor(document, { autoSaveEnabled: false });
      expect(button).toContain("立即保存");
      expect(button).not.toContain("disabled");
    });

    it.each([
      { draftState: undefined },
      { locked: true },
      { document: { ...document, readOnly: true } },
      { saving: true },
      { manualSaving: true }
    ])("disables unavailable manual saves (%j)", async (state) => {
      const button = await renderEditor(document, {
        autoSaveEnabled: false,
        ...state
      });
      expect(button).toContain("disabled");
      expect(button).toContain(state.manualSaving ? "保存中…" : "立即保存");
    });
  }
);
