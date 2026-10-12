import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { isReactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudBackupStatus,
  AgentTeamCatalogSnapshot,
  LibraryAgentSettings,
  LongAgentSettings,
  ModelSettings,
  WorkspaceDirectorySettings
} from "@deepwrite/contracts";
import { DEFAULT_LONG_AGENT_SETTINGS } from "@deepwrite/contracts";
import { useSettingsStore, type SettingsLoader } from "./settingsStore";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function modelSettings(id = "model-a"): ModelSettings {
  return {
    defaultModelId: id,
    models: []
  } as ModelSettings;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("settings store", () => {
  it("deduplicates concurrent loads and reuses the loaded snapshot", async () => {
    const store = useSettingsStore();
    const pending = deferred<ModelSettings>();
    const loader = vi.fn(() => pending.promise);

    const first = store.ensureModelsLoaded(loader);
    const second = store.ensureModelsLoaded(loader);
    expect(loader).toHaveBeenCalledOnce();
    expect(store.modelLoading).toBe(true);

    const loaded = modelSettings();
    pending.resolve(loaded);
    await expect(first).resolves.toBe(loaded);
    await expect(second).resolves.toBe(loaded);
    expect(store.modelSettings).toBe(loaded);
    expect(store.modelsLoaded).toBe(true);
    expect(store.modelLoading).toBe(false);

    await expect(store.ensureModelsLoaded(loader)).resolves.toBe(loaded);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("clears a rejected single-flight request so the domain can retry", async () => {
    const store = useSettingsStore();
    const failedLoader = vi.fn(async () => {
      throw new Error("模型设置暂时不可用");
    });

    await expect(store.ensureModelsLoaded(failedLoader)).rejects.toThrow(
      "模型设置暂时不可用"
    );
    expect(store.modelsLoaded).toBe(false);
    expect(store.modelLoading).toBe(false);
    expect(store.modelError).toBe("模型设置暂时不可用");

    const loaded = modelSettings("model-retry");
    const retryLoader = vi.fn(async () => loaded);
    await expect(store.ensureModelsLoaded(retryLoader)).resolves.toBe(loaded);
    expect(retryLoader).toHaveBeenCalledOnce();
    expect(store.modelError).toBeNull();
    expect(store.modelSettings).toBe(loaded);
  });

  it("ignores a stale load result after invalidation", async () => {
    const store = useSettingsStore();
    const stale = deferred<WorkspaceDirectorySettings>();
    const fresh = deferred<WorkspaceDirectorySettings>();

    const staleRequest = store.ensureWorkspaceDirectoryLoaded(
      () => stale.promise
    );
    store.invalidate("workspaceDirectory");
    const freshRequest = store.ensureWorkspaceDirectoryLoaded(
      () => fresh.promise
    );

    stale.resolve({ path: "/stale" } as WorkspaceDirectorySettings);
    await expect(staleRequest).resolves.toEqual({ path: "/stale" });
    expect(store.workspaceDirectoryPath).toBeNull();
    expect(store.workspaceDirectoryLoading).toBe(true);

    fresh.resolve({ path: "/fresh" } as WorkspaceDirectorySettings);
    await freshRequest;
    expect(store.workspaceDirectoryPath).toBe("/fresh");
    expect(store.workspaceDirectoryLoaded).toBe(true);
    expect(store.workspaceDirectoryLoading).toBe(false);
  });

  it("supports markLoaded and invalidate without discarding the last snapshot", async () => {
    const store = useSettingsStore();
    const settings = modelSettings("model-saved");

    store.markLoaded("models", settings);
    expect(store.modelSettings).toBe(settings);
    expect(store.modelsLoaded).toBe(true);

    store.invalidate("models");
    expect(store.modelsLoaded).toBe(false);
    expect(store.modelSettings).toBe(settings);

    const loader = vi.fn(async () => modelSettings("model-refreshed"));
    await store.ensureLoaded("models", loader);
    expect(loader).toHaveBeenCalledOnce();
    expect(store.modelSettings?.defaultModelId).toBe("model-refreshed");
  });

  it("provides independent ensureLoaded resources for every deferred settings domain", async () => {
    const store = useSettingsStore();
    const agentTeams = {
      enabledTeamIds: {},
      teams: []
    } as unknown as AgentTeamCatalogSnapshot;
    const longAgents = structuredClone(
      DEFAULT_LONG_AGENT_SETTINGS
    ) as LongAgentSettings;
    const libraryAgents = { agents: [] } as unknown as LibraryAgentSettings;

    await Promise.all([
      store.ensureLongAgentsLoaded(async () => longAgents),
      store.ensureAgentTeamsLoaded(async () => agentTeams),
      store.ensureLibraryAgentsLoaded(async () => libraryAgents)
    ]);

    expect(store.longAgentLoaded).toBe(true);
    expect(store.agentTeamLoaded).toBe(true);
    expect(store.libraryAgentsLoaded).toBe(true);
    expect(store.longAgentSettings).toBe(longAgents);
    expect(store.agentTeamCatalog).toBe(agentTeams);
    expect(store.libraryAgentSettings).toBe(libraryAgents);
  });

  it("retains and coalesces cloud backup status across feature remounts", async () => {
    const store = useSettingsStore();
    const pending = deferred<CloudBackupStatus>();
    const loader = vi.fn(() => pending.promise);
    const status = {
      configured: true,
      machineKey: "DW-ABCD-2345-EFGH-WXYZ",
      quotaBytes: 100_000_000,
      usedBytes: 12,
      localItemCount: 3,
      remoteItemCount: 2,
      lastBackupAt: "2026-08-13T00:00:00.000Z"
    } as CloudBackupStatus;

    const first = store.ensureCloudBackupLoaded(loader);
    const remountedFeature = store.ensureCloudBackupLoaded(loader);
    expect(loader).toHaveBeenCalledOnce();
    pending.resolve(status);

    await expect(first).resolves.toBe(status);
    await expect(remountedFeature).resolves.toBe(status);
    await expect(store.ensureCloudBackupLoaded(loader)).resolves.toBe(status);
    expect(loader).toHaveBeenCalledOnce();
    expect(store.cloudBackupStatus).toBe(status);
    expect(store.cloudBackupLoaded).toBe(true);
  });

  it("prevents an older model request from overwriting saved model settings", async () => {
    const store = useSettingsStore();
    const stale = deferred<ModelSettings>();
    const staleRequest = store.ensureModelsLoaded(() => stale.promise);
    store.markLoaded("models", modelSettings("saved-newer"));
    stale.resolve(modelSettings("stale-model"));
    await staleRequest;

    expect(store.modelSettings?.defaultModelId).toBe("saved-newer");
    expect(store.modelsLoaded).toBe(true);
    expect(store.modelLoading).toBe(false);
  });

  it("keeps large settings snapshots outside Vue deep proxies", () => {
    const refs = storeToRefs(useSettingsStore());

    expect(isReactive(refs.generalSettings.value)).toBe(false);
    expect(isReactive(refs.modelSettings.value)).toBe(false);
    expect(isReactive(refs.longAgentSettings.value)).toBe(false);
    expect(isReactive(refs.agentTeamCatalog.value)).toBe(false);
    expect(isReactive(refs.libraryAgentSettings.value)).toBe(false);
  });

  it("preserves loader result types for generic callers", async () => {
    const store = useSettingsStore();
    const loader: SettingsLoader<"workspaceDirectory"> = async () =>
      ({
        path: "/workspace"
      }) as WorkspaceDirectorySettings;

    const result = await store.ensureLoaded("workspaceDirectory", loader);
    expect(result.path).toBe("/workspace");
  });
});
