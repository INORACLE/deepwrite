import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { LongWorkspaceIndexResultSchema } from "@deepwrite/contracts";
import { LongWorkspaceService } from "./long-workspace-service";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

it("returns the latest book metadata with one index and no full book payload", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-workspace-index-"))
  );
  try {
    const userDataPath = join(root, "user-data");
    const service = new LongWorkspaceService({ userDataPath });
    const { book } = await service.create(root, {
      title: "原作品名称",
      genre: "悬疑"
    });
    await service.list();
    const external = new LongWorkspaceService({ userDataPath });
    await external.renameBook({ bookId: book.id, title: "更新的作品名称" });
    const updated = await external.updateBindings({
      bookId: book.id,
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [],
        draft: [],
        other: []
      },
      linkedSkillIdsByKind: {
        general: ["skill_current"],
        plot: [],
        style: [],
        other: []
      }
    });

    const result = LongWorkspaceIndexResultSchema.parse(
      await service.getWorkspaceIndex({ bookId: book.id })
    );
    const { navigation: _navigation, ...metadata } = updated.summary;
    expect(result.metadata).toEqual(metadata);
    expect(result.metadata).not.toHaveProperty("navigation");
    expect(result.workspaceIndex).toEqual(updated.book.workspaceIndex);
    expect(result).not.toHaveProperty("book");
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
});
