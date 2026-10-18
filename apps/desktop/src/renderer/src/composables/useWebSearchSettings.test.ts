import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, watch } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type {
  WebSearchKeyImportCandidate,
  WebSearchSettings,
  WebSearchSettingsInput
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import { useWebSearchStatusStore } from "../stores/webSearchStatus";
import { dismissUiMessage, uiMessageItems } from "../ui-feedback";
import { useWebSearchSettings } from "./useWebSearchSettings";

const t = createScopedTranslator("components.webSearchSettings");

function settings(
  overrides: Partial<WebSearchSettings> = {},
  hasApiKey = true
): WebSearchSettings {
  return {
    enabled: true,
    activeProviderId: "deepseek",
    perRunCallLimit: 20,
    profiles: [{ providerId: "deepseek", maxResults: 8, hasApiKey }],
    ...overrides
  };
}

function candidate(
  id: string,
  matchesCurrentKey = false
): WebSearchKeyImportCandidate {
  return {
    sourceModelId: id,
    keyHint: "…a1b2",
    models: [{ id, label: `模型 ${id}` }],
    matchesCurrentKey
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function makeApi(initial: WebSearchSettings = settings()) {
  return {
    getSettings: vi.fn(async () => initial),
    saveSettings: vi.fn(async (_input: WebSearchSettingsInput) => initial),
    setEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => ({
      ...initial,
      enabled
    })),
    test: vi.fn(async () => ({ resultCount: 3, elapsedMs: 1234, samples: [] })),
    listKeyImportCandidates: vi.fn(async () => ({
      candidates: [] as WebSearchKeyImportCandidate[],
      hasCurrentKey: true
    })),
    importKey: vi.fn(async () => initial)
  };
}

function messages() {
  return uiMessageItems.value.map(({ kind, content }) => ({ kind, content }));
}

async function setup(api = makeApi()) {
  vi.stubGlobal("window", { deepwrite: { webSearch: api } });
  const scope = effectScope();
  const controller = scope.run(() => useWebSearchSettings())!;
  await controller.load();
  return { api, controller, scope };
}

beforeEach(() => {
  setActivePinia(createPinia());
  uiMessageItems.value.forEach(({ id }) => dismissUiMessage(id));
});
afterEach(() => vi.unstubAllGlobals());

describe("useWebSearchSettings loading", () => {
  it("fills the form and hints at an importable model when no key is saved", async () => {
    const api = makeApi(settings({}, false));
    api.listKeyImportCandidates.mockResolvedValue({
      candidates: [candidate("m_chat")],
      hasCurrentKey: false
    });
    const { controller } = await setup(api);
    await vi.waitFor(() =>
      expect(controller.statusText.value).toBe(
        t("statusNoKeyImportable", { provider: controller.provider.value })
      )
    );
    expect(controller.draft).toMatchObject({
      maxResults: 8,
      perRunCallLimit: 20
    });
    expect(controller.dirty.value).toBe(false);
  });

  it("reports a load failure and lets the page retry", async () => {
    const api = makeApi();
    api.getSettings.mockRejectedValueOnce(new Error("磁盘不可读"));
    const { controller } = await setup(api);
    expect(controller.loaded.value).toBe(false);
    expect(messages()).toEqual([{ kind: "error", content: "磁盘不可读" }]);
    await controller.load();
    expect(controller.loaded.value).toBe(true);
  });
});

describe("useWebSearchSettings switch", () => {
  it("flips once without a page-level busy state, then settles on Main's reply", async () => {
    const reply = deferred<WebSearchSettings>();
    const api = makeApi();
    api.setEnabled.mockReturnValue(reply.promise);
    const { controller, scope } = await setup(api);
    const seen: boolean[] = [];
    scope.run(() =>
      watch(
        () => controller.settings.value?.enabled,
        (enabled) => seen.push(enabled!),
        { flush: "sync" }
      )
    );
    const pending = controller.setEnabled(false);
    expect(controller.settings.value?.enabled).toBe(false);
    expect(controller.saving.value).toBe(false);
    expect(controller.loading.value).toBe(false);
    reply.resolve(settings({ enabled: false }));
    await pending;
    expect(seen).toEqual([false]);
    expect(messages()).toEqual([
      { kind: "success", content: t("disabledToast") }
    ]);
  });

  it("applies only the newest reply when toggled twice quickly", async () => {
    const first = deferred<WebSearchSettings>();
    const second = deferred<WebSearchSettings>();
    const api = makeApi();
    api.setEnabled
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { controller } = await setup(api);
    const one = controller.setEnabled(false);
    const two = controller.setEnabled(true);
    second.resolve(settings({ enabled: true }));
    await two;
    first.resolve(settings({ enabled: false }));
    await one;
    expect(controller.settings.value?.enabled).toBe(true);
  });

  it("restores the authoritative state and says so when the request fails", async () => {
    const api = makeApi();
    api.setEnabled.mockRejectedValue(new Error("保存失败"));
    const { controller } = await setup(api);
    await controller.setEnabled(false);
    expect(controller.settings.value?.enabled).toBe(true);
    expect(messages()).toEqual([{ kind: "error", content: "保存失败" }]);
  });
});

describe("useWebSearchSettings session switch status", () => {
  it("tells the session switches whether search can be given", async () => {
    const status = useWebSearchStatusStore;
    await setup(makeApi(settings({}, true)));
    await nextTick();
    expect(status().usable).toBe(true);
  });

  it("is unusable while no key is saved", async () => {
    await setup(makeApi(settings({}, false)));
    await nextTick();
    expect(useWebSearchStatusStore().usable).toBe(false);
  });

  it("follows the switch at once, before Main answers", async () => {
    const reply = deferred<WebSearchSettings>();
    const api = makeApi();
    api.setEnabled.mockReturnValue(reply.promise);
    const { controller } = await setup(api);
    await nextTick();
    expect(useWebSearchStatusStore().usable).toBe(true);
    const pending = controller.setEnabled(false);
    await nextTick();
    expect(useWebSearchStatusStore().usable).toBe(false);
    reply.resolve(settings({ enabled: false }));
    await pending;
    await nextTick();
    expect(useWebSearchStatusStore().usable).toBe(false);
  });
});

describe("useWebSearchSettings save", () => {
  it("sends only the edited provider with a typed key and then clears the draft key", async () => {
    const api = makeApi();
    const saved = settings({ perRunCallLimit: 12 });
    api.saveSettings.mockResolvedValue(saved);
    const { controller } = await setup(api);
    controller.draft.perRunCallLimit = 12;
    controller.draft.maxResults = 5;
    controller.draft.apiKey = "  invalid-test-key ";
    expect(controller.dirty.value).toBe(true);
    await controller.save();
    expect(api.saveSettings).toHaveBeenCalledWith({
      enabled: true,
      activeProviderId: "deepseek",
      perRunCallLimit: 12,
      profiles: [
        { providerId: "deepseek", maxResults: 5, apiKey: "invalid-test-key" }
      ]
    });
    expect(controller.draft.apiKey).toBe("");
    expect(controller.saving.value).toBe(false);
    expect(messages()).toEqual([{ kind: "success", content: t("saved") }]);
  });

  it("asks to clear the saved key only when no new one is typed", async () => {
    const { api, controller } = await setup();
    controller.toggleClearKey();
    expect(controller.hasUsableKey.value).toBe(false);
    await controller.save();
    expect(api.saveSettings.mock.calls[0]![0].profiles[0]).toEqual({
      providerId: "deepseek",
      maxResults: 8,
      clearApiKey: true
    });
  });

  it("does nothing when unchanged and rejects out-of-range numbers locally", async () => {
    const { api, controller } = await setup();
    await controller.save();
    controller.draft.maxResults = 99;
    await controller.save();
    controller.draft.maxResults = 8;
    controller.draft.perRunCallLimit = 0;
    await controller.save();
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(messages().map((message) => message.kind)).toEqual([
      "warning",
      "warning"
    ]);
  });

  it("keeps the edits and reports the reason when saving fails", async () => {
    const api = makeApi();
    api.saveSettings.mockRejectedValue(new Error("系统安全存储不可用"));
    const { controller } = await setup(api);
    controller.draft.apiKey = "invalid-test-key";
    await controller.save();
    expect(controller.draft.apiKey).toBe("invalid-test-key");
    expect(controller.saving.value).toBe(false);
    expect(messages()).toEqual([
      { kind: "error", content: "系统安全存储不可用" }
    ]);
  });
});

describe("useWebSearchSettings test search", () => {
  it("needs a key, then reports the result count and time", async () => {
    const api = makeApi(settings({}, false));
    const { controller } = await setup(api);
    await controller.test();
    expect(api.test).not.toHaveBeenCalled();
    controller.draft.apiKey = "invalid-test-key";
    await controller.test();
    expect(api.test).toHaveBeenCalledWith({
      providerId: "deepseek",
      apiKey: "invalid-test-key"
    });
    expect(messages().map((message) => message.content)).toEqual([
      t("testNeedsKey"),
      t("testSuccess", { count: 3, seconds: "1.2" })
    ]);
  });
});

describe("useWebSearchSettings key import", () => {
  it("says so when no model qualifies", async () => {
    const { controller } = await setup();
    await controller.startImport();
    expect(messages()).toEqual([
      {
        kind: "warning",
        content: t("importNone", { provider: controller.provider.value })
      }
    ]);
  });

  it("imports a single model straight away when no key is saved, keeping unsaved parameters", async () => {
    const api = makeApi(settings({}, false));
    api.listKeyImportCandidates.mockResolvedValue({
      candidates: [candidate("m_chat")],
      hasCurrentKey: false
    });
    api.importKey.mockResolvedValue(settings());
    const { controller } = await setup(api);
    controller.draft.maxResults = 4;
    controller.draft.apiKey = "invalid-test-typed-key";
    await controller.startImport();
    expect(api.importKey).toHaveBeenCalledWith({
      providerId: "deepseek",
      sourceModelId: "m_chat"
    });
    expect(controller.importRequest.value).toBeNull();
    expect(controller.draft).toMatchObject({ maxResults: 4, apiKey: "" });
    expect(controller.profile.value?.hasApiKey).toBe(true);
    expect(controller.importing.value).toBe(false);
    expect(messages().at(-1)).toEqual({
      kind: "success",
      content: t("importDone", { model: "模型 m_chat" })
    });
  });

  it("does not import the key already in use", async () => {
    const api = makeApi();
    api.listKeyImportCandidates.mockResolvedValue({
      candidates: [candidate("m_chat", true)],
      hasCurrentKey: true
    });
    const { controller } = await setup(api);
    await controller.startImport();
    expect(api.importKey).not.toHaveBeenCalled();
    expect(controller.importRequest.value).toBeNull();
    expect(messages()).toEqual([
      { kind: "info", content: t("importAlreadyUsing") }
    ]);
  });

  it("asks before replacing a different key, and when several models qualify", async () => {
    const api = makeApi();
    api.listKeyImportCandidates.mockResolvedValue({
      candidates: [candidate("m_chat")],
      hasCurrentKey: true
    });
    const { controller } = await setup(api);
    await controller.startImport();
    expect(api.importKey).not.toHaveBeenCalled();
    expect(controller.importRequest.value?.hasCurrentKey).toBe(true);
    controller.cancelImport();
    expect(controller.importRequest.value).toBeNull();

    api.listKeyImportCandidates.mockResolvedValue({
      candidates: [candidate("m_chat"), candidate("m_work")],
      hasCurrentKey: false
    });
    await controller.startImport();
    expect(controller.importRequest.value?.candidates).toHaveLength(2);
  });

  it("imports the chosen model from the dialog and closes it", async () => {
    const api = makeApi();
    api.listKeyImportCandidates.mockResolvedValue({
      candidates: [candidate("m_chat"), candidate("m_work")],
      hasCurrentKey: true
    });
    const { controller } = await setup(api);
    await controller.startImport();
    await controller.confirmImport("m_work");
    expect(api.importKey).toHaveBeenCalledWith({
      providerId: "deepseek",
      sourceModelId: "m_work"
    });
    expect(controller.importRequest.value).toBeNull();
    expect(controller.importConfirming.value).toBe(false);
  });

  it("closes the dialog and reports the reason when the import is refused", async () => {
    const api = makeApi();
    api.listKeyImportCandidates.mockResolvedValue({
      candidates: [candidate("m_chat"), candidate("m_work")],
      hasCurrentKey: false
    });
    api.importKey.mockRejectedValue(new Error("所选模型已不符合导入条件"));
    const { controller } = await setup(api);
    await controller.startImport();
    await controller.confirmImport("m_chat");
    expect(controller.importRequest.value).toBeNull();
    expect(messages()).toEqual([
      { kind: "error", content: "所选模型已不符合导入条件" }
    ]);
  });
});
