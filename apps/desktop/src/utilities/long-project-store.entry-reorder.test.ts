import {
  FIXED_NOW,
  createEmptyLongMarkdownFileReference,
  createFixture,
  describe,
  expect,
  it,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  store
} from "./long-project-store.test-support";

describe("long entry reorder persistence", () => {
  it("keeps the new order after reopening and preserves overview and entry contents", async () => {
    const { projectStore, created } = await createFixture("entry-reorder");
    const category = created.book.workspaceIndex.worldbuilding.find(
      ({ format }) => format === "list"
    )!;
    if (category.format !== "list") throw new Error("Expected a list category");
    const items = ["one", "two", "three"].map((suffix, index) => {
      const id = `worlditem_reorder_${suffix}`;
      return {
        id,
        title: `世界观条目 ${index + 1}`,
        order: category.items.length + index + 1,
        file: createEmptyLongMarkdownFileReference(
          longWorldbuildingItemFileId(id),
          longWorldbuildingItemContentPath(category.id, id),
          FIXED_NOW
        )
      };
    });
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: items.map((item) => ({
          type: "worldbuildingItem.create",
          categoryId: category.id,
          item
        })),
        documentWrites: []
      }
    });
    await projectStore.writeDocument(created.projectDirectory, {
      fileId: category.overview!.id,
      content: "固定在前面的概览。"
    });
    for (const item of items) {
      await projectStore.writeDocument(created.projectDirectory, {
        fileId: item.file.id,
        content: `${item.title} 的原有正文。`
      });
    }
    const orderedIds = [
      items[2]!.id,
      ...category.items.map(({ id }) => id),
      items[0]!.id,
      items[1]!.id
    ];
    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "worldbuildingItem.reorder",
            categoryId: category.id,
            orderedIds
          }
        ],
        documentWrites: []
      }
    });
    const reopenedStore = store();
    const reopened = await reopenedStore.openBook(created.projectDirectory);
    const saved = reopened.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === category.id
    )!;
    if (saved.format !== "list") throw new Error("Expected a list category");
    expect(saved.items.map(({ id }) => id)).toEqual(orderedIds);
    expect(saved.overview).toMatchObject({
      id: category.overview!.id,
      path: category.overview!.path
    });
    await expect(
      reopenedStore.readDocument(created.projectDirectory, {
        fileId: saved.overview!.id
      })
    ).resolves.toMatchObject({ content: "固定在前面的概览。" });
    for (const item of items) {
      expect(saved.items.find(({ id }) => id === item.id)?.file.path).toBe(
        item.file.path
      );
      await expect(
        reopenedStore.readDocument(created.projectDirectory, {
          fileId: item.file.id
        })
      ).resolves.toMatchObject({ content: `${item.title} 的原有正文。` });
    }
  });
});
