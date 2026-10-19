import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudBackupService } from "./service";
import type { CloudBackupObjectStore } from "./oss-client";
import { CLOUD_BACKUP_QUOTA_BYTES } from "@deepwrite/contracts";
import { packBackupSnapshot, snapshotObjectKeys } from "./packager";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

class MemoryStore implements CloudBackupObjectStore {
  readonly objects = new Map<string, Buffer>();

  async getObject(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }
}

async function setupWorkspace(): Promise<{
  userData: string;
  workspace: string;
}> {
  const userData = await mkdtemp(
    join(tmpdir(), "deepwrite-cloud-backup-user-")
  );
  const workspace = await mkdtemp(join(tmpdir(), "deepwrite-cloud-backup-ws-"));
  roots.push(userData, workspace);
  const bookDir = join(workspace, "books", "测试书");
  await mkdir(bookDir, { recursive: true });
  await writeFile(
    join(bookDir, "deepwrite.json"),
    `${JSON.stringify({ id: "book_test", title: "测试书", kind: "book" }, null, 2)}\n`
  );
  await writeFile(join(bookDir, "body.md"), "# hello\n");
  await writeFile(
    join(userData, "catalog-registry.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        revision: 1,
        updatedAt: "2026-08-13T00:00:00.000Z",
        sourceCatalogMigrated: true,
        creativePlotStages: [],
        projects: [
          {
            id: "book_test",
            domain: "book",
            projectDirectory: bookDir,
            registeredAt: "2026-08-13T00:00:00.000Z"
          }
        ]
      },
      null,
      2
    )}\n`
  );
  return { userData, workspace };
}

async function previewFixture() {
  const fixture = await setupWorkspace();
  const store = new MemoryStore();
  const hooks = {
    getWorkspaceDirectory: async () => fixture.workspace,
    registerCatalogProject: vi.fn(async () => undefined),
    registerLongBook: vi.fn(async () => undefined)
  };
  const service = new CloudBackupService(
    fixture.userData,
    hooks,
    store,
    () => new Date("2026-08-13T01:00:00.000Z")
  );
  const { machineKey } = await service.status();
  return { ...fixture, store, hooks, service, machineKey };
}

function replaceRemoteSnapshot(store: MemoryStore, machineKey: string) {
  const keys = snapshotObjectKeys(machineKey);
  const packed = packBackupSnapshot(machineKey, "2026-08-13T02:00:00.000Z", []);
  store.objects.set(keys.archive, packed.zip);
  store.objects.set(
    keys.manifest,
    Buffer.from(JSON.stringify(packed.manifest))
  );
}

describe("cloud backup service", () => {
  it("uploads a packed snapshot and restores it onto another workspace after confirm", async () => {
    const { userData, workspace } = await setupWorkspace();
    const store = new MemoryStore();
    const registered: string[] = [];
    const service = new CloudBackupService(
      userData,
      {
        getWorkspaceDirectory: async () => workspace,
        registerCatalogProject: async ({ projectDirectory }) => {
          registered.push(projectDirectory);
        },
        registerLongBook: async () => undefined
      },
      store,
      () => new Date("2026-08-13T01:00:00.000Z")
    );

    const status = await service.status();
    expect(status.configured).toBe(true);
    expect(status.localItemCount).toBe(1);
    expect(status.quotaBytes).toBe(CLOUD_BACKUP_QUOTA_BYTES);

    const uploadPreview = await service.previewBackup();
    expect(
      uploadPreview.changes.some((change) => change.change === "add")
    ).toBe(true);
    const uploaded = await service.applyBackup(uploadPreview.previewId);
    expect(uploaded.added).toBe(1);
    expect(store.objects.size).toBe(2);

    const otherUser = await mkdtemp(
      join(tmpdir(), "deepwrite-cloud-backup-other-")
    );
    const otherWorkspace = await mkdtemp(
      join(tmpdir(), "deepwrite-cloud-backup-other-ws-")
    );
    roots.push(otherUser, otherWorkspace);
    await writeFile(
      join(otherUser, "catalog-registry.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          revision: 1,
          updatedAt: "2026-08-13T00:00:00.000Z",
          sourceCatalogMigrated: true,
          creativePlotStages: [],
          projects: []
        },
        null,
        2
      )}\n`
    );
    const other = new CloudBackupService(
      otherUser,
      {
        getWorkspaceDirectory: async () => otherWorkspace,
        registerCatalogProject: async ({ projectDirectory }) => {
          registered.push(projectDirectory);
        },
        registerLongBook: async () => undefined
      },
      store,
      () => new Date("2026-08-13T02:00:00.000Z")
    );
    const restorePreview = await other.previewRestore(status.machineKey);
    expect(restorePreview.changes.map((change) => change.change)).toEqual([
      "add"
    ]);
    await other.applyRestore(restorePreview.previewId);
    expect(registered.length).toBe(1);
    const restored = await readFile(
      join(registered[0]!, "deepwrite.json"),
      "utf8"
    );
    expect(restored).toContain("测试书");
  });

  it("rejects applying an unknown preview instead of writing blindly", async () => {
    const { userData, workspace } = await setupWorkspace();
    const service = new CloudBackupService(
      userData,
      {
        getWorkspaceDirectory: async () => workspace,
        registerCatalogProject: async () => undefined,
        registerLongBook: async () => undefined
      },
      new MemoryStore()
    );
    await expect(service.applyRestore("preview_missing")).rejects.toThrow(
      "同步预览已过期"
    );
  });

  it.each(["created", "updated", "removed"])(
    "rejects an upload preview when the remote snapshot was %s without changing cloud files",
    async (change) => {
      const { service, store, machineKey } = await previewFixture();
      if (change !== "created") {
        const initial = await service.previewBackup();
        await service.applyBackup(initial.previewId);
      }
      const preview = await service.previewBackup();
      if (change === "removed") store.objects.clear();
      else replaceRemoteSnapshot(store, machineKey);
      const before = new Map(store.objects);
      const upload = vi.spyOn(store, "putObject");

      await expect(service.applyBackup(preview.previewId)).rejects.toThrow(
        "云端备份在预览后发生变化"
      );
      expect(upload).not.toHaveBeenCalled();
      expect(store.objects).toEqual(before);
    }
  );

  it.each(["updated", "removed"])(
    "rejects a restore preview when the remote snapshot was %s and preserves local edits",
    async (change) => {
      const { service, store, hooks, machineKey, workspace } =
        await previewFixture();
      const upload = await service.previewBackup();
      await service.applyBackup(upload.previewId);
      const body = join(workspace, "books", "测试书", "body.md");
      const localContent = "本地尚未备份的修改。";
      await writeFile(body, localContent);
      const preview = await service.previewRestore(machineKey);
      expect(preview.changes.some(({ change }) => change === "overwrite")).toBe(
        true
      );
      if (change === "removed") store.objects.clear();
      else replaceRemoteSnapshot(store, machineKey);
      const download = vi.spyOn(store, "getObject");

      await expect(service.applyRestore(preview.previewId)).rejects.toThrow(
        "云端备份在预览后发生变化"
      );
      expect(download).not.toHaveBeenCalledWith(
        snapshotObjectKeys(machineKey).archive
      );
      expect(await readFile(body, "utf8")).toBe(localContent);
      expect(hooks.registerCatalogProject).not.toHaveBeenCalled();
      expect(hooks.registerLongBook).not.toHaveBeenCalled();
    }
  );
});
