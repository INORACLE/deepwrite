import { computed, reactive, ref, watch } from "vue";
import {
  WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX,
  WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN,
  WebSearchSettingsInputSchema,
  webSearchProvider,
  type WebSearchProviderId,
  type WebSearchSettings
} from "@deepwrite/contracts/renderer";
import { locale } from "../i18n";
import { getErrorDetail } from "../i18n/errors";
import { useWebSearchStatusStore } from "../stores/webSearchStatus";
import { uiMessage } from "../ui-feedback";
import {
  webSearchApi,
  webSearchProviderLabel,
  webSearchProviderName,
  webSearchT as t,
  type WebSearchDraft
} from "./web-search-settings/bridge";
import { useWebSearchKeyImport } from "./web-search-settings/key-import";

export { webSearchProviderLabel };

/**
 * State and operations of the "联网搜索" settings page. The switch is an
 * immediate, reversible action; saving, testing and importing busy only their
 * own buttons, never other controls.
 */
export function useWebSearchSettings() {
  const settings = ref<WebSearchSettings | null>(null);
  // Session switches follow the settings as they change, saved or not yet.
  const status = useWebSearchStatusStore();
  watch(settings, (value) => {
    if (value) status.apply(value);
  });
  const draft = reactive<WebSearchDraft>({
    activeProviderId: "deepseek",
    maxResults: 8,
    perRunCallLimit: 20,
    apiKey: "",
    clearKey: false
  });
  const loaded = ref(false);
  // Counts as loading from the start, so nothing flashes before the first read.
  const loading = ref(true);
  const saving = ref(false);
  const testing = ref(false);
  let enabledRevision = 0;
  let loadRevision = 0;

  const profile = computed(() =>
    settings.value?.profiles.find(
      (entry) => entry.providerId === draft.activeProviderId
    )
  );
  const descriptor = computed(() => webSearchProvider(draft.activeProviderId));
  const provider = computed(() =>
    webSearchProviderName(draft.activeProviderId)
  );
  const providerLabel = computed(() =>
    webSearchProviderLabel(draft.activeProviderId)
  );
  const canImport = computed(() => Boolean(descriptor.value.keyImport));
  const hasUsableKey = computed(
    () =>
      draft.apiKey.trim() !== "" ||
      (Boolean(profile.value?.hasApiKey) && !draft.clearKey)
  );
  const dirty = computed(() => {
    const saved = settings.value;
    if (!saved) return false;
    return (
      draft.apiKey.trim() !== "" ||
      draft.clearKey ||
      draft.activeProviderId !== saved.activeProviderId ||
      draft.perRunCallLimit !== saved.perRunCallLimit ||
      draft.maxResults !== profile.value?.maxResults
    );
  });
  const limits = computed(() => ({
    minResults: 1,
    maxResults: descriptor.value.maxResultsCap,
    minCalls: WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN,
    maxCalls: WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX
  }));

  function resetKeyDraft(): void {
    draft.apiKey = "";
    draft.clearKey = false;
  }

  const keyImport = useWebSearchKeyImport({
    settings,
    draft,
    provider,
    canImport,
    resetKeyDraft
  });

  const statusText = computed(() => {
    const saved = settings.value;
    if (!saved) return "";
    if (!profile.value?.hasApiKey)
      return keyImport.importHint.value
        ? t("statusNoKeyImportable", { provider: provider.value })
        : t("statusNoKey");
    return saved.enabled
      ? t("statusOn", { provider: providerLabel.value })
      : t("statusOff");
  });
  const keySourceText = computed(() => {
    const source = profile.value?.keySource;
    if (!profile.value?.hasApiKey) return t("keyNotSaved");
    if (!source || source.kind === "manual") return t("keySourceManual");
    return t("keySourceModel", {
      model: source.modelLabel,
      date: new Date(source.importedAt).toLocaleDateString(locale.value, {
        month: "long",
        day: "numeric"
      })
    });
  });

  function maxResultsOf(
    snapshot: WebSearchSettings,
    id: WebSearchProviderId
  ): number {
    return (
      snapshot.profiles.find((entry) => entry.providerId === id)?.maxResults ??
      webSearchProvider(id).defaultMaxResults
    );
  }

  function syncDraft(snapshot: WebSearchSettings): void {
    draft.activeProviderId = snapshot.activeProviderId;
    draft.perRunCallLimit = snapshot.perRunCallLimit;
    draft.maxResults = maxResultsOf(snapshot, snapshot.activeProviderId);
    resetKeyDraft();
  }

  async function load(): Promise<void> {
    const revision = ++loadRevision;
    loading.value = true;
    try {
      const snapshot = await webSearchApi().getSettings();
      if (revision !== loadRevision) return;
      settings.value = snapshot;
      syncDraft(snapshot);
      loaded.value = true;
      void keyImport.detectImportable(snapshot);
    } catch (error) {
      if (revision === loadRevision)
        uiMessage.error(getErrorDetail(error) ?? t("loadFailed"));
    } finally {
      if (revision === loadRevision) loading.value = false;
    }
  }

  function selectProvider(id: WebSearchProviderId): void {
    draft.activeProviderId = id;
    draft.maxResults = settings.value
      ? maxResultsOf(settings.value, id)
      : webSearchProvider(id).defaultMaxResults;
    resetKeyDraft();
  }

  /** Optimistic: show the new state now, settle on Main's reply, undo on failure. */
  async function setEnabled(enabled: boolean): Promise<void> {
    const current = settings.value;
    if (!current || current.enabled === enabled) return;
    const revision = ++enabledRevision;
    settings.value = { ...current, enabled };
    try {
      const snapshot = await webSearchApi().setEnabled({ enabled });
      if (revision === enabledRevision) settings.value = snapshot;
      uiMessage.success(t(enabled ? "enabledToast" : "disabledToast"));
    } catch (error) {
      uiMessage.error(getErrorDetail(error) ?? t("toggleFailed"));
      try {
        const snapshot = await webSearchApi().getSettings();
        if (revision === enabledRevision) settings.value = snapshot;
      } catch {
        // Keep the view; the failure message has already been shown.
      }
    }
  }

  function validNumbers(): boolean {
    const { maxResults, perRunCallLimit } = draft;
    return (
      Number.isInteger(maxResults) &&
      maxResults >= 1 &&
      maxResults <= descriptor.value.maxResultsCap &&
      Number.isInteger(perRunCallLimit) &&
      perRunCallLimit >= WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN &&
      perRunCallLimit <= WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX
    );
  }

  async function save(): Promise<void> {
    const current = settings.value;
    if (!current || saving.value || !dirty.value) return;
    if (!validNumbers()) {
      uiMessage.warning(t("invalidNumbers", limits.value));
      return;
    }
    saving.value = true;
    try {
      const apiKey = draft.apiKey.trim();
      const input = WebSearchSettingsInputSchema.parse({
        enabled: current.enabled,
        activeProviderId: draft.activeProviderId,
        perRunCallLimit: draft.perRunCallLimit,
        profiles: [
          {
            providerId: draft.activeProviderId,
            maxResults: draft.maxResults,
            ...(apiKey
              ? { apiKey }
              : draft.clearKey
                ? { clearApiKey: true }
                : {})
          }
        ]
      });
      const snapshot = await webSearchApi().saveSettings(input);
      settings.value = snapshot;
      syncDraft(snapshot);
      uiMessage.success(t("saved"));
      void keyImport.detectImportable(snapshot);
    } catch (error) {
      uiMessage.error(getErrorDetail(error) ?? t("saveFailed"));
    } finally {
      saving.value = false;
    }
  }

  async function test(): Promise<void> {
    if (testing.value) return;
    if (!hasUsableKey.value) {
      uiMessage.warning(t("testNeedsKey"));
      return;
    }
    testing.value = true;
    try {
      const apiKey = draft.apiKey.trim();
      const result = await webSearchApi().test({
        providerId: draft.activeProviderId,
        ...(apiKey ? { apiKey } : {})
      });
      uiMessage.success(
        t("testSuccess", {
          count: result.resultCount,
          seconds: (result.elapsedMs / 1000).toFixed(1)
        })
      );
    } catch (error) {
      uiMessage.error(getErrorDetail(error) ?? t("testFailed"));
    } finally {
      testing.value = false;
    }
  }

  function toggleClearKey(): void {
    draft.clearKey = !draft.clearKey;
    if (draft.clearKey) draft.apiKey = "";
  }

  return {
    settings,
    draft,
    loaded,
    loading,
    saving,
    testing,
    profile,
    descriptor,
    provider,
    providerLabel,
    canImport,
    hasUsableKey,
    dirty,
    limits,
    statusText,
    keySourceText,
    load,
    selectProvider,
    setEnabled,
    save,
    test,
    toggleClearKey,
    importing: keyImport.importing,
    importRequest: keyImport.importRequest,
    importConfirming: keyImport.importConfirming,
    startImport: keyImport.startImport,
    confirmImport: keyImport.confirmImport,
    cancelImport: keyImport.cancelImport
  };
}

export type WebSearchSettingsController = ReturnType<
  typeof useWebSearchSettings
>;
