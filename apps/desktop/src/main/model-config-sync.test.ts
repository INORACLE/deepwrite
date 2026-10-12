import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncModelConfig, SyncModelEntry } from "@deepwrite/contracts";
import {
  temporaryRoots,
  emptyCatalog,
  customModel,
  managedModel
} from "./model-config-store.test-support";

const storage = vi.hoisted(() => ({ available: true, brokenDecrypt: false }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => {
      if (storage.brokenDecrypt) throw new Error("decrypt failed");
      return value.toString("utf8");
    }
  }
}));

const { ModelConfigStore } = await import("./model-config-store");

async function createStore(withManagedKey = false) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-model-sync-"));
  temporaryRoots.push(root);
  const store = new ModelConfigStore(root, {
    freeModelCatalog: {
      initialize: async () => undefined,
      getCatalog: async () => ({
        ...emptyCatalog(),
        enabled: true,
        manifestAvailable: true,
        canDeprecateMissingModels: true,
        models: [managedModel("writer")],
        apiKeys: withManagedKey
          ? { "deepwrite-free-writing": "invalid-managed-test-key" }
          : {}
      })
    }
  });
  return { root, store };
}

async function storedKeyIds(root: string): Promise<string[]> {
  const file = JSON.parse(
    await readFile(join(root, "config", "models.json"), "utf8")
  ) as { encryptedApiKeys: Record<string, string> };
  return Object.keys(file.encryptedApiKeys);
}

function synced(overrides: Partial<SyncModelConfig> = {}): SyncModelConfig {
  const { id, label, provider, modelId, api, baseUrl } = customModel();
  return {
    id,
    label,
    provider,
    modelId,
    api,
    baseUrl,
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    ...overrides
  };
}

const entry = (model: SyncModelConfig, apiKey?: string): SyncModelEntry => ({
  model,
  ...(apiKey ? { apiKey } : {})
});

describe("ModelConfigStore device sync", () => {
  beforeEach(() => {
    storage.available = true;
    storage.brokenDecrypt = false;
  });

  it("lists custom models with their own key and excludes managed models", async () => {
    const { root, store } = await createStore(true);
    await store.save({
      models: [
        { ...customModel(), apiKey: "sk-sync-test-only" },
        { ...customModel(), id: "keyless-writer", label: "无密钥模型" }
      ],
      defaultModelId: "custom-writer"
    });
    await store.setFreeModelEnabled("deepwrite-free-writing", true);

    const listed = await store.listSyncModels();
    expect(listed.map(({ model }) => model.id)).toEqual([
      "custom-writer",
      "keyless-writer"
    ]);
    expect(listed[0]!.apiKey).toBe("sk-sync-test-only");
    expect(listed[1]).not.toHaveProperty("apiKey");
    expect(listed[0]!.model).not.toHaveProperty("apiKey");
    expect(JSON.stringify(listed)).not.toContain("invalid-managed-test-key");
    expect(
      await readFile(join(root, "config", "models.json"), "utf8")
    ).toContain("custom-writer");
  });

  it("keeps a model local when its key is too long to travel", async () => {
    const { store } = await createStore();
    await store.save({
      models: [
        { ...customModel(), apiKey: "k".repeat(1_025) },
        { ...customModel(), id: "fits-writer", apiKey: "k".repeat(1_024) }
      ],
      defaultModelId: "custom-writer"
    });

    expect((await store.listSyncModels()).map(({ model }) => model.id)).toEqual(
      ["fits-writer"]
    );
  });

  it("adds a synced model with its key, or without one, and keeps the local default", async () => {
    const { root, store } = await createStore();
    await store.save({
      models: [customModel()],
      defaultModelId: "custom-writer"
    });

    await store.applySyncedModels([
      {
        id: "phone-model",
        expected: null,
        next: entry(synced({ id: "phone-model" }), "sk-phone-test-only")
      },
      {
        id: "keyless-model",
        expected: null,
        next: entry(synced({ id: "keyless-model", label: "无密钥" }))
      }
    ]);

    const state = await store.list();
    expect(state.models.find((m) => m.id === "phone-model")).toMatchObject({
      hasApiKey: true,
      label: "自定义写作模型"
    });
    expect(state.models.find((m) => m.id === "keyless-model")).toMatchObject({
      hasApiKey: false
    });
    expect(state.defaultModelId).toBe("custom-writer");
    expect((await store.resolve("phone-model"))?.apiKey).toBe(
      "sk-phone-test-only"
    );
    expect(await storedKeyIds(root)).toEqual(["phone-model"]);
    expect(
      await readFile(join(root, "config", "models.json"), "utf8")
    ).not.toContain("sk-phone-test-only");
  });

  it("makes the local key mirror the synced item: replace it, keep it, or remove it", async () => {
    const { root, store } = await createStore();
    await store.save({
      models: [{ ...customModel(), apiKey: "sk-keep-test-only" }],
      defaultModelId: "custom-writer"
    });
    const [current] = await store.listSyncModels();

    await store.applySyncedModels([
      {
        id: "custom-writer",
        expected: current!,
        next: entry(
          { ...current!.model, label: "改名后的模型" },
          "sk-keep-test-only"
        )
      }
    ]);
    expect(await store.resolve("custom-writer")).toMatchObject({
      apiKey: "sk-keep-test-only"
    });

    const [renamed] = await store.listSyncModels();
    await store.applySyncedModels([
      {
        id: "custom-writer",
        expected: renamed!,
        next: entry(
          { ...renamed!.model, baseUrl: "https://other.example.test/v1" },
          "sk-moved-test-only"
        )
      }
    ]);
    expect(await store.resolve("custom-writer")).toMatchObject({
      baseUrl: "https://other.example.test/v1",
      apiKey: "sk-moved-test-only"
    });

    const [moved] = await store.listSyncModels();
    await store.applySyncedModels([
      { id: "custom-writer", expected: moved!, next: entry(moved!.model) }
    ]);
    expect(
      (await store.list()).models.find((m) => m.id === "custom-writer")
    ).toMatchObject({ hasApiKey: false });
    expect(await storedKeyIds(root)).toEqual([]);
  });

  it("removes the model and its key on a synced deletion, then falls back the default", async () => {
    const { root, store } = await createStore();
    await store.save({
      models: [
        { ...customModel(), apiKey: "sk-delete-test-only" },
        { ...customModel(), id: "second-writer", label: "第二个模型" }
      ],
      defaultModelId: "custom-writer"
    });
    const [first] = await store.listSyncModels();

    await store.applySyncedModels([
      { id: "custom-writer", expected: first!, next: null }
    ]);

    const state = await store.list();
    expect(state.models.map((model) => model.id)).not.toContain(
      "custom-writer"
    );
    expect(state.defaultModelId).toBe("second-writer");
    await expect(store.resolve("custom-writer")).rejects.toThrow("不存在");
    expect(await storedKeyIds(root)).toEqual([]);
  });

  it("rejects a change built on a stale copy, including a stale key, and changes nothing", async () => {
    const { root, store } = await createStore();
    await store.save({
      models: [{ ...customModel(), apiKey: "sk-stale-test-only" }],
      defaultModelId: "custom-writer"
    });
    const [current] = await store.listSyncModels();

    for (const expected of [
      entry({ ...current!.model, label: "别处的旧名称" }, "sk-stale-test-only"),
      entry(current!.model, "sk-other-test-only"),
      entry(current!.model)
    ])
      await expect(
        store.applySyncedModels([
          {
            id: "custom-writer",
            expected,
            next: entry({ ...current!.model, label: "远端新名称" })
          }
        ])
      ).rejects.toThrow("模型配置已在本机修改");
    expect((await store.listSyncModels())[0]).toEqual(current);
    expect(await storedKeyIds(root)).toEqual(["custom-writer"]);
  });

  it("fails closed when a stored key cannot be read instead of reporting it as removed", async () => {
    const { store } = await createStore();
    await store.save({
      models: [{ ...customModel(), apiKey: "sk-locked-test-only" }],
      defaultModelId: "custom-writer"
    });

    storage.brokenDecrypt = true;
    await expect(store.listSyncModels()).rejects.toThrow("解密失败");
    await expect(
      store.applySyncedModels([
        {
          id: "custom-writer",
          expected: entry(synced()),
          next: entry(synced({ label: "远端新名称" }))
        }
      ])
    ).rejects.toThrow("解密失败");
    storage.brokenDecrypt = false;
    expect((await store.resolve("custom-writer"))?.apiKey).toBe(
      "sk-locked-test-only"
    );
  });

  it("refuses to store a synced key without system secure storage", async () => {
    const { store } = await createStore();
    await store.save({ models: [], defaultModelId: "" });

    storage.available = false;
    await expect(
      store.applySyncedModels([
        {
          id: "phone-model",
          expected: null,
          next: entry(synced({ id: "phone-model" }), "sk-phone-test-only")
        }
      ])
    ).rejects.toThrow("安全存储");
    storage.available = true;
    expect(await store.listSyncModels()).toEqual([]);
  });

  it("does not let a synced change touch a managed model", async () => {
    const { store } = await createStore();
    await store.setFreeModelEnabled("deepwrite-free-writing", true);

    for (const next of [null, entry(synced({ id: "deepwrite-free-writing" }))])
      await expect(
        store.applySyncedModels([{ id: "deepwrite-free-writing", next }])
      ).rejects.toThrow("托管");
    expect((await store.list()).models.map((model) => model.id)).toContain(
      "deepwrite-free-writing"
    );
  });

  it("refuses to grow past the custom model limit", async () => {
    const { store } = await createStore();
    const changes = Array.from({ length: 101 }, (_, index) => ({
      id: `bulk-${index}`,
      next: entry(synced({ id: `bulk-${index}`, label: `批量模型 ${index}` }))
    }));

    await expect(store.applySyncedModels(changes)).rejects.toThrow(
      "数量已达上限"
    );
    expect(await store.listSyncModels()).toEqual([]);
  });
});
