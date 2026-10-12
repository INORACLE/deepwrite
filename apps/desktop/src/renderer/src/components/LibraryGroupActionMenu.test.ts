import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import LibraryGroupActionMenu from "./LibraryGroupActionMenu.vue";
import LibraryRemovalDialog from "./LibraryRemovalDialog.vue";
import { i18n } from "../i18n";

describe("library group menus and confirmation", () => {
  it("separates the action and resource in an English confirmation title", async () => {
    const originalLocale = i18n.global.locale.value;
    i18n.global.locale.value = "en-US";
    try {
      const context: { teleports?: Record<string, string> } = {};
      await renderToString(
        createSSRApp({
          render: () =>
            h(LibraryRemovalDialog, {
              open: true,
              action: "delete",
              domain: "material",
              isGroup: true,
              label: "Test group"
            })
        }),
        context
      );
      expect(context.teleports?.body).toContain("Delete material group");
    } finally {
      i18n.global.locale.value = originalLocale;
    }
  });
  it("places permanent group deletion directly after dissolve", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () => h(LibraryGroupActionMenu)
      })
    );
    const labels = [...html.matchAll(/<span>([^<]+)<\/span>/gu)].map(
      (match) => match[1]
    );
    expect(labels).toEqual([
      "编辑分组",
      "复制",
      "导出",
      "解散分组",
      "删除分组"
    ]);
  });

  it.each(["material", "skill"] as const)(
    "explicitly confirms permanent deletion of a %s group and every member library",
    async (domain) => {
      const context: { teleports?: Record<string, string> } = {};
      await renderToString(
        createSSRApp({
          render: () =>
            h(LibraryRemovalDialog, {
              open: true,
              action: "delete",
              domain,
              isGroup: true,
              label: "测试分组"
            })
        }),
        context
      );
      const html = context.teleports?.body ?? "";
      expect(html).toContain(
        domain === "material" ? "删除素材分组" : "删除技能分组"
      );
      expect(html).toContain(
        domain === "material" ? "组内全部素材库" : "组内全部技能库"
      );
      expect(html).toContain("此操作无法撤销");
      expect(html).toContain("确认删除");
    }
  );
});
